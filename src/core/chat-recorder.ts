import { CaptureNotAllowedError, type Camera } from './camera';
import { contextBandText, withContextBand } from './context-band';
import { localDayOf, type DaySpan, type LocalDay } from './day-span';
import { chatRecordFileName } from './file-name';
import { PageNotRecognisedError, type Rect, type WhatsAppPage } from './whatsapp-page';

/**
 * What to record:
 * - `date-range`: every message from the start of local day `from` to the end
 *   of local day `to` (both included, as WhatsApp Web's date dividers show days);
 * - `visible`: just the chat area currently on screen.
 * Full Chat joins this union in a later ticket.
 */
export type ChatRecordRequest = { kind: 'visible' } | { kind: 'date-range'; from: LocalDay; to: LocalDay };

export interface ChatRecord {
  /** The Chat this record is of. */
  chatName: string;
  format: 'png';
  /** The Context Band above WhatsApp Web's own pixels, encoded as `format`. */
  image: Blob;
  /** The name to save it under, for example `Chat history - Alice - 2026-11-11.png`. */
  fileName: string;
  /**
   * The days the Chat Record covers. For a Date Range: the first and last day
   * that have messages in the record (the first day's divider starts it, the
   * last day's last message ends it), which can be narrower than requested.
   */
  span: DaySpan;
  /** When the Chat Record was taken. */
  takenAt: Date;
  /** The Context Band's text, one entry per line. */
  contextBand: string[];
}

export type ChatRecordOutcome =
  | { kind: 'record'; record: ChatRecord }
  /** The requested Date Range has no messages; nothing was made. */
  | { kind: 'no-messages'; from: LocalDay; to: LocalDay }
  /** The record was cancelled through its signal; nothing was made. */
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: FailureReason; detail: string };

export type FailureReason =
  /** WhatsApp Web's page did not match what the adapter expects. */
  | 'page-not-recognised'
  /** Chrome has not given the extension access to capture this tab. */
  | 'capture-not-allowed'
  /** Capturing the screen failed for another reason (for example a hidden tab). */
  | 'capture-failed'
  /** Another Chat Record is still being made; only one runs at a time. */
  | 'busy';

/** How far a Chat Record has got, reported after every screen captured. */
export interface RecordProgress {
  /** Screens (chat-area viewports) captured so far in this Chat Record. */
  screensCaptured: number;
  /**
   * The day of the last message captured so far. Absent when the recorder
   * does not read days (a record of the visible chat).
   */
  reachedDay?: LocalDay;
}

export interface RecordOptions {
  /** Called once per screen captured. */
  onProgress?: (progress: RecordProgress) => void;
  /**
   * Aborting it cancels the record: it stops scrolling and capturing as soon
   * as it can and resolves to `cancelled`, producing nothing.
   */
  signal?: AbortSignal;
}

export interface ChatRecorder {
  /** Makes one Chat Record. While one is being made, another `record` fails at once with `busy`. */
  record(request: ChatRecordRequest, options?: RecordOptions): Promise<ChatRecordOutcome>;
}

export interface ChatRecorderDeps {
  page: WhatsAppPage;
  camera: Camera;
  /** The current time; tells when a Chat Record was taken. Defaults to the system clock. */
  clock?: () => Date;
}

type Deps = Required<ChatRecorderDeps>;

/** One recording's deps and options. */
interface Run extends Deps {
  onProgress: (progress: RecordProgress) => void;
  /** Throws `Cancelled` if the record has been cancelled. Call it after every wait. */
  checkpoint: () => void;
}

/** Unwinds a cancelled record. */
class Cancelled extends Error {}

export function createChatRecorder({ page, camera, clock }: ChatRecorderDeps): ChatRecorder {
  const deps: Deps = { page, camera, clock: clock ?? (() => new Date()) };
  let busy = false;
  return {
    async record(request, options = {}) {
      if (busy) return { kind: 'failed', reason: 'busy', detail: 'a Chat Record is already being made' };
      busy = true;
      try {
        return await recordOnce(deps, request, options);
      } finally {
        busy = false;
      }
    },
  };
}

async function recordOnce(deps: Deps, request: ChatRecordRequest, options: RecordOptions): Promise<ChatRecordOutcome> {
  const { signal } = options;
  const run: Run = {
    ...deps,
    onProgress: options.onProgress ?? (() => {}),
    checkpoint() {
      if (signal?.aborted) throw new Cancelled();
    },
  };
  try {
    run.checkpoint();
    const outcome = request.kind === 'date-range' ? await recordDateRange(run, request) : await recordVisible(run);
    run.checkpoint();
    return outcome;
  } catch (error) {
    if (error instanceof Cancelled || signal?.aborted) return { kind: 'cancelled' };
    return { kind: 'failed', reason: failureReason(error), detail: errorMessage(error) };
  }
}

async function recordVisible(run: Run): Promise<ChatRecordOutcome> {
  const chatName = run.page.chatName();
  const area = run.page.chatArea();
  const takenAt = run.clock();
  const screenshot = await run.camera.capture();
  run.checkpoint();
  run.onProgress({ screensCaptured: 1 });
  const pixels = crop(screenshot.bitmap, area, screenshot.devicePixelRatio);
  const span = visibleChatSpan(takenAt);
  return finishRecord({ chatName, span, takenAt, pixels, devicePixelRatio: screenshot.devicePixelRatio });
}

/**
 * Puts the Context Band above `pixels` (WhatsApp Web's own pixels, untouched)
 * and names the Chat Record, both from the span it actually covers.
 */
async function finishRecord(parts: {
  chatName: string;
  span: DaySpan;
  takenAt: Date;
  pixels: OffscreenCanvas;
  devicePixelRatio: number;
}): Promise<ChatRecordOutcome> {
  const { chatName, span, takenAt } = parts;
  const contextBand = contextBandText({ chatName, span, takenAt });
  const withBand = withContextBand(parts.pixels, contextBand, parts.devicePixelRatio);
  const image = await withBand.convertToBlob({ type: 'image/png' });
  const fileName = chatRecordFileName(chatName, span, 'png');
  return { kind: 'record', record: { chatName, format: 'png', image, fileName, span, takenAt, contextBand } };
}

/**
 * The days a record of the visible chat covers. The recorder does not read
 * the dates of the messages on screen yet, so this is the day the record was
 * taken. A Date Range record uses the span actually captured instead.
 */
function visibleChatSpan(takenAt: Date): DaySpan {
  const today = localDayOf(takenAt);
  return { from: today, to: today };
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
  run: Run,
  request: { from: LocalDay; to: LocalDay },
): Promise<ChatRecordOutcome> {
  const { page, camera } = run;
  const { from, to } = request;
  const noMessages: ChatRecordOutcome = { kind: 'no-messages', from, to };
  const chatName = page.chatName();
  const area = page.chatArea();
  const takenAt = run.clock();

  const first = await scrollToFirstDivider(run, from, area.height);
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
    run.checkpoint();
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
      run.checkpoint();
      devicePixelRatio = screenshot.devicePixelRatio;
      const sliceTo = Math.min(visibleTo, end);
      slices.push(await cutSlice(screenshot.bitmap, area, devicePixelRatio, covered, sliceTo, visibleFrom));
      covered = sliceTo;
      run.onProgress({ screensCaptured: slices.length, reachedDay: dayAt(dividerRows, covered - 1) });
    }
    if (endKnown && covered >= end) break;
    if (atBottom) throw new Error('WhatsApp Web stopped scrolling before the end of the range');
    await page.scrollTo(origin + covered - captureOverlap);
  }

  if (!lastInRange) return noMessages;
  const pixels = stitch(slices, area, devicePixelRatio, lastInRange.row);
  const span = { from: first.day, to: lastInRange.day };
  return finishRecord({ chatName, span, takenAt, pixels, devicePixelRatio });
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
async function scrollToFirstDivider(run: Run, from: LocalDay, step: number) {
  const { page } = run;
  let goingDown = false;
  let sawMessages = false;
  for (let stop = 0; stop < maxScrollStops; stop++) {
    run.checkpoint();
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

function stitch(slices: Slice[], area: Rect, devicePixelRatio: number, rows: number): OffscreenCanvas {
  const width = Math.round(area.width * devicePixelRatio);
  const height = Math.round(rows * devicePixelRatio);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  for (const slice of slices) {
    context.drawImage(slice.bitmap, 0, slice.y);
    slice.bitmap.close();
  }
  return canvas;
}

function failureReason(error: unknown): FailureReason {
  if (error instanceof PageNotRecognisedError) return 'page-not-recognised';
  if (error instanceof CaptureNotAllowedError) return 'capture-not-allowed';
  return 'capture-failed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function crop(bitmap: ImageBitmap, area: Rect, devicePixelRatio: number): OffscreenCanvas {
  const left = Math.round(area.left * devicePixelRatio);
  const top = Math.round(area.top * devicePixelRatio);
  const width = Math.round(area.width * devicePixelRatio);
  const height = Math.round(area.height * devicePixelRatio);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
  return canvas;
}
