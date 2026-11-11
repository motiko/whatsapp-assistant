import { CaptureNotAllowedError, type Camera } from './camera';
import { contextBandText, withContextBand } from './context-band';
import { localDayOf, type DaySpan, type LocalDay } from './day-span';
import { chatRecordFileName } from './file-name';
import { pdfOfImages } from './pdf';
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
  /**
   * `png` for one image; `pdf` for a Chat Record taller than
   * `maxPngChatAreaHeights` chat areas, as pages of about one chat area each.
   */
  format: 'png' | 'pdf';
  /**
   * The Context Band above WhatsApp Web's own pixels, encoded as `format`: one
   * PNG image, or a PDF whose pages are lossless images, broken between
   * messages, with the Context Band at the top of the first page.
   */
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

export interface ChatRecorderDeps {
  page: WhatsAppPage;
  camera: Camera;
  /** The current time; tells when a Chat Record was taken. Defaults to the system clock. */
  clock?: () => Date;
}

type Deps = Required<ChatRecorderDeps>;

export function createChatRecorder({ page, camera, clock }: ChatRecorderDeps): ChatRecorder {
  const deps: Deps = { page, camera, clock: clock ?? (() => new Date()) };
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
  const takenAt = deps.clock();
  const screenshot = await deps.camera.capture();
  const { devicePixelRatio } = screenshot;
  const slice = await cutSlice(screenshot.bitmap, area, devicePixelRatio, 0, area.height, 0);
  const span = visibleChatSpan(takenAt);
  const stitched = { slices: [slice], area, devicePixelRatio, rows: area.height, pageBreaks: new Set<number>() };
  return finishRecord({ chatName, span, takenAt, stitched });
}

/**
 * A Chat Record taller than this many chat-area heights (about one screen
 * each) is a PDF instead of a PNG, to stay usable and within Chrome's image
 * size limits.
 */
const maxPngChatAreaHeights = 10;

/**
 * Puts the Context Band above the stitched WhatsApp Web pixels (untouched),
 * as one PNG or, when taller than `maxPngChatAreaHeights` chat areas, as a
 * PDF of pages about one chat area tall, and names the Chat Record; all from
 * the span it actually covers. Takes ownership of the slices.
 */
async function finishRecord(parts: {
  chatName: string;
  span: DaySpan;
  takenAt: Date;
  stitched: Stitched;
}): Promise<ChatRecordOutcome> {
  const { chatName, span, takenAt, stitched } = parts;
  const { area, devicePixelRatio, rows } = stitched;
  const contextBand = contextBandText({ chatName, span, takenAt });
  const format = rows > maxPngChatAreaHeights * area.height ? 'pdf' : 'png';
  const fileName = chatRecordFileName(chatName, span, format);
  try {
    let image: Blob;
    if (format === 'png') {
      const pixels = stitchRows(stitched, { from: 0, to: rows });
      image = await withContextBand(pixels, contextBand, devicePixelRatio).convertToBlob({ type: 'image/png' });
    } else {
      const pages = pageSpans(rows, stitched.pageBreaks, area.height);
      // One page's canvas at a time: the whole record would be too tall for one.
      const images = (async function* () {
        for (const [index, page] of pages.entries()) {
          const pixels = stitchRows(stitched, page);
          yield index === 0 ? withContextBand(pixels, contextBand, devicePixelRatio) : pixels;
        }
      })();
      image = await pdfOfImages(images, { devicePixelRatio, title: fileName.replace(/\.pdf$/, ''), createdAt: takenAt });
    }
    return { kind: 'record', record: { chatName, format, image, fileName, span, takenAt, contextBand } };
  } finally {
    for (const slice of stitched.slices) slice.bitmap.close();
  }
}

/**
 * Splits `rows` rows (record rows, CSS px) into pages of at most `pageHeight`
 * rows. Each page ends at the latest place it may break (the top of a message
 * or date divider) that fits. Only a message taller than a whole page, with no
 * such place in reach, is split, at exactly `pageHeight`.
 */
function pageSpans(rows: number, pageBreaks: Set<number>, pageHeight: number): RowSpan[] {
  const breaks = [...pageBreaks].filter((row) => row > 0 && row < rows).sort((a, b) => a - b);
  const pages: RowSpan[] = [];
  let from = 0;
  while (rows - from > pageHeight) {
    const fitting = breaks.filter((row) => row > from && row <= from + pageHeight);
    const to = fitting.at(-1) ?? from + pageHeight;
    pages.push({ from, to });
    from = to;
  }
  pages.push({ from, to: rows });
  return pages;
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
  deps: Deps,
  request: { from: LocalDay; to: LocalDay },
): Promise<ChatRecordOutcome> {
  const { page, camera } = deps;
  const { from, to } = request;
  const noMessages: ChatRecordOutcome = { kind: 'no-messages', from, to };
  const chatName = page.chatName();
  const area = page.chatArea();
  const takenAt = deps.clock();

  const first = await scrollToFirstDivider(page, from, area.height);
  if (!first || first.day > to) return noMessages;

  // Walk down one chat-area height at a time from the first day's divider.
  // Content positions can shift between stops (WhatsApp Web loads older
  // messages above), so everything is kept relative to the first divider
  // ("record rows") and re-anchored on any divider seen before.
  const dividerRows = new Map<LocalDay, number>([[first.day, 0]]);
  /** Record rows where a PDF page may start: the tops of messages and date dividers. */
  const pageBreaks = new Set<number>();
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
      if (top > 0) pageBreaks.add(top);
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
  const span = { from: first.day, to: lastInRange.day };
  const stitched = { slices, area, devicePixelRatio, rows: lastInRange.row, pageBreaks };
  return finishRecord({ chatName, span, takenAt, stitched });
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

/** A run of record rows (CSS px), `from` included and `to` not. */
interface RowSpan {
  from: number;
  to: number;
}

/** The slices of a Chat Record, which together cover rows 0 to `rows` of the chat area without gaps. */
interface Stitched {
  slices: Slice[];
  area: Rect;
  devicePixelRatio: number;
  rows: number;
  /** Record rows where a PDF page may start (see `pageSpans`). */
  pageBreaks: Set<number>;
}

/** Rows `span` of the stitched slices, as one image. */
function stitchRows({ slices, area, devicePixelRatio }: Stitched, span: RowSpan): OffscreenCanvas {
  const top = Math.round(span.from * devicePixelRatio);
  const bottom = Math.round(span.to * devicePixelRatio);
  const canvas = new OffscreenCanvas(Math.round(area.width * devicePixelRatio), bottom - top);
  const context = canvas.getContext('2d')!;
  for (const slice of slices) {
    if (slice.y < bottom && slice.y + slice.bitmap.height > top) context.drawImage(slice.bitmap, 0, slice.y - top);
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
