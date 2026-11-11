import { CaptureNotAllowedError, type Camera } from './camera';
import { PageNotRecognisedError, type LocalDay, type Rect, type WhatsAppPage } from './whatsapp-page';

/**
 * What to record:
 * - `date-range`: every message from the start of local day `from` to the end
 *   of local day `to` (both included, as WhatsApp Web's date dividers show days);
 * - `visible`: just the chat area currently on screen.
 * Full Chat joins this union in a later ticket.
 */
export type ChatRecordRequest = { kind: 'visible' } | { kind: 'date-range'; from: LocalDay; to: LocalDay };

/** The days a Chat Record actually covers, both included. */
export interface DateSpan {
  from: LocalDay;
  to: LocalDay;
}

export interface ChatRecord {
  /** The Chat this record is of. */
  chatName: string;
  format: 'png';
  /** WhatsApp Web's own pixels, encoded as `format`. */
  image: Blob;
  /**
   * For a Date Range: the first and last day that have messages in the
   * record (the first day's divider starts it, the last day's last message
   * ends it). Absent for a record of the visible chat area.
   */
  span?: DateSpan;
}

export type ChatRecordOutcome =
  | { kind: 'record'; record: ChatRecord }
  /** The requested Date Range has no messages; nothing was made. */
  | { kind: 'no-messages'; from: LocalDay; to: LocalDay }
  | { kind: 'failed'; reason: FailureReason; detail: string };

export type FailureReason =
  /** WhatsApp Web's page did not match what the adapter expects. */
  | 'page-not-recognised'
  /** Chrome has not given the extension access to capture this tab. */
  | 'capture-not-allowed'
  /** Capturing the screen failed for another reason (for example a hidden tab). */
  | 'capture-failed';

export interface ChatRecorder {
  record(request: ChatRecordRequest): Promise<ChatRecordOutcome>;
}

type Deps = { page: WhatsAppPage; camera: Camera };

export function createChatRecorder(deps: Deps): ChatRecorder {
  return {
    async record(request) {
      try {
        return request.kind === 'date-range' ? await recordDateRange(deps, request) : await recordVisible(deps);
      } catch (error) {
        return { kind: 'failed', reason: failureReason(error), detail: errorMessage(error) };
      }
    },
  };
}

async function recordVisible(deps: Deps): Promise<ChatRecordOutcome> {
  const chatName = deps.page.chatName();
  const area = deps.page.chatArea();
  const screenshot = await deps.camera.capture();
  const image = await cropToPng(screenshot.bitmap, area, screenshot.devicePixelRatio);
  return { kind: 'record', record: { chatName, format: 'png', image } };
}

/**
 * Overlap between consecutive captures, in CSS px. Rows already captured are
 * not used again; the overlap only keeps rounding at fractional scroll
 * positions from leaving a gap.
 */
const captureOverlap = 8;

/** Upper bound on scroll stops, so a page that never settles cannot loop forever. */
const maxScrollStops = 10_000;

async function recordDateRange(
  deps: Deps,
  request: { from: LocalDay; to: LocalDay },
): Promise<ChatRecordOutcome> {
  const { page, camera } = deps;
  const { from, to } = request;
  const noMessages: ChatRecordOutcome = { kind: 'no-messages', from, to };
  const chatName = page.chatName();
  const area = page.chatArea();

  const first = await scrollToFirstDivider(page, from, area.height);
  if (!first || first.day > to) return noMessages;

  // Walk down one chat-area height at a time from the first day's divider.
  // Content positions can shift between stops (WhatsApp Web loads older
  // messages above), so everything is kept relative to the first divider
  // ("record rows") and re-anchored on any divider seen before.
  const dividerRows = new Map<LocalDay, number>([[first.day, 0]]);
  let origin = first.top;
  let lastInRange: { row: number; day: LocalDay } | undefined;
  let endKnown = false;
  let covered = 0;
  let devicePixelRatio = 1;
  const slices: Slice[] = [];

  await page.scrollTo(origin);
  for (let stop = 0; ; stop++) {
    if (stop >= maxScrollStops) throw new Error('WhatsApp Web did not stop scrolling');
    const items = page.loadedItems();
    const anchor = items.find((item) => item.kind === 'date-divider' && dividerRows.has(item.day));
    if (anchor?.kind === 'date-divider') origin = anchor.top - dividerRows.get(anchor.day)!;

    let day: LocalDay | undefined;
    for (const item of items) {
      const top = item.top - origin;
      const bottom = item.bottom - origin;
      if (item.kind === 'date-divider') {
        if (top < 0) continue;
        dividerRows.set(item.day, top);
        if (item.day > to) endKnown = true;
        day = item.day;
        continue;
      }
      if (top < 0) continue;
      day ??= dayAt(dividerRows, top);
      if (day <= to && (!lastInRange || bottom > lastInRange.row)) lastInRange = { row: bottom, day };
    }

    const scrollTop = page.scrollTop();
    const atBottom = scrollTop + area.height >= page.scrollHeight() - 1;
    if (atBottom) endKnown = true;
    const visibleFrom = scrollTop - origin;
    const visibleTo = visibleFrom + area.height;
    const end = endKnown ? (lastInRange?.row ?? 0) : Infinity;

    if (visibleFrom > covered) throw new Error('WhatsApp Web did not scroll to where the Chat Record continues');
    if (covered < Math.min(visibleTo, end)) {
      const screenshot = await camera.capture();
      devicePixelRatio = screenshot.devicePixelRatio;
      const sliceTo = Math.min(visibleTo, end);
      slices.push(await cutSlice(screenshot.bitmap, area, devicePixelRatio, covered, sliceTo, visibleFrom));
      covered = sliceTo;
    }
    if (endKnown && covered >= end) break;
    if (atBottom) throw new Error('WhatsApp Web stopped scrolling before the end of the range');
    await page.scrollTo(origin + covered - captureOverlap);
  }

  if (!lastInRange) return noMessages;
  const image = await stitch(slices, area, devicePixelRatio, lastInRange.row);
  return {
    kind: 'record',
    record: { chatName, format: 'png', image, span: { from: first.day, to: lastInRange.day } },
  };
}

/** The day of the latest known divider at or above `row`. */
function dayAt(dividerRows: Map<LocalDay, number>, row: number): LocalDay {
  let best: { day: LocalDay; row: number } | undefined;
  for (const [day, dividerRow] of dividerRows) {
    if (dividerRow <= row && (!best || dividerRow > best.row)) best = { day, row: dividerRow };
  }
  return best!.day;
}

/**
 * Scrolls until the date divider of the first day on or after `from` is
 * loaded, and returns it (in content positions read at the last stop), or
 * undefined if no day on or after `from` has messages.
 */
async function scrollToFirstDivider(page: WhatsAppPage, from: LocalDay, step: number) {
  let goingDown = false;
  let sawMessages = false;
  for (let stop = 0; stop < maxScrollStops; stop++) {
    const items = page.loadedItems();
    const dividers = items.flatMap((item) => (item.kind === 'date-divider' ? [item] : []));
    sawMessages ||= items.some((item) => item.kind === 'message');
    const scrollTop = page.scrollTop();
    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + step >= page.scrollHeight() - 1;
    const index = dividers.findIndex((divider) => divider.day >= from);

    // A divider for `from` or later is the first such one once an earlier
    // day's divider is loaded above it, or when nothing is above it.
    if (index > 0 || (index === 0 && (atTop || goingDown))) return dividers[index];
    if (index === -1 && dividers.length > 0) goingDown = true;
    if (goingDown) {
      if (atBottom) return undefined;
      await page.scrollTo(scrollTop + step);
    } else {
      if (atTop) {
        if (sawMessages) throw new PageNotRecognisedError('no date dividers in the message list');
        return undefined;
      }
      await page.scrollTo(scrollTop - step);
    }
  }
  throw new Error('WhatsApp Web did not stop scrolling');
}

/** Rows `fromRow` to `toRow` (record rows, CSS px) of the chat area, cut from one capture. */
interface Slice {
  bitmap: ImageBitmap;
  /** Where the slice goes in the stitched image, in device pixels. */
  y: number;
}

async function cutSlice(
  screen: ImageBitmap,
  area: Rect,
  devicePixelRatio: number,
  fromRow: number,
  toRow: number,
  visibleFromRow: number,
): Promise<Slice> {
  const y = Math.round(fromRow * devicePixelRatio);
  const height = Math.round(toRow * devicePixelRatio) - y;
  const sourceTop = Math.round((area.top - visibleFromRow) * devicePixelRatio) + y;
  const left = Math.round(area.left * devicePixelRatio);
  const width = Math.round(area.width * devicePixelRatio);
  const bitmap = await createImageBitmap(screen, left, sourceTop, width, height);
  screen.close();
  return { bitmap, y };
}

async function stitch(slices: Slice[], area: Rect, devicePixelRatio: number, rows: number): Promise<Blob> {
  const width = Math.round(area.width * devicePixelRatio);
  const height = Math.round(rows * devicePixelRatio);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  for (const slice of slices) {
    context.drawImage(slice.bitmap, 0, slice.y);
    slice.bitmap.close();
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

function failureReason(error: unknown): FailureReason {
  if (error instanceof PageNotRecognisedError) return 'page-not-recognised';
  if (error instanceof CaptureNotAllowedError) return 'capture-not-allowed';
  return 'capture-failed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function cropToPng(bitmap: ImageBitmap, area: Rect, devicePixelRatio: number): Promise<Blob> {
  const left = Math.round(area.left * devicePixelRatio);
  const top = Math.round(area.top * devicePixelRatio);
  const width = Math.round(area.width * devicePixelRatio);
  const height = Math.round(area.height * devicePixelRatio);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/png' });
}
