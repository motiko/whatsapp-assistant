import { CaptureNotAllowedError, type Camera } from './camera';
import { contextBandText, withContextBand } from './context-band';
import { localDayOf, type DaySpan, type LocalDay } from './day-span';
import { chatRecordFileName } from './file-name';
import { pdfOfImages } from './pdf';
import { PageNotRecognisedError, type ChatItem, type Rect, type WhatsAppPage } from './whatsapp-page';

/**
 * What to record:
 * - `date-range`: every message from the start of local day `from` to the end
 *   of local day `to` (both included, as WhatsApp Web's date dividers show days);
 * - `full-chat`: every message WhatsApp Web can load, oldest to newest;
 * - `visible`: just the chat area currently on screen.
 */
export type ChatRecordRequest =
  | { kind: 'visible' }
  | { kind: 'date-range'; from: LocalDay; to: LocalDay }
  | { kind: 'full-chat' };

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
   * For a Full Chat: the earliest day WhatsApp Web could load to the newest.
   */
  span: DaySpan;
  /** When the Chat Record was taken. */
  takenAt: Date;
  /** The Context Band's text, one entry per line. */
  contextBand: string[];
  /**
   * WhatsApp Web ran out of older messages before the requested Date Range's
   * first day, so the record starts at the earliest day available (and its
   * Context Band says so).
   */
  historyIncomplete: boolean;
}

/** A Date Range or the Full Chat: a request that walks the Chat day by day. */
export type RangeRequest = Extract<ChatRecordRequest, { kind: 'date-range' | 'full-chat' }>;

/**
 * Where a Continuation picks up after a Partial Chat Record. Only names and
 * dates: the Chat, the original request, WhatsApp Web's id of the last
 * message captured with its day and time, and why the run failed; never
 * message content or pixels.
 */
export interface ContinuationPoint {
  chatName: string;
  /** What the failed run was asked to record; a Continuation runs to its end. */
  request: RangeRequest;
  /** The last message the Partial Chat Record holds in full. */
  lastMessage: { id: string; day: LocalDay; time?: string };
  reason: FailureReason;
  /** The Partial Chat Record's file name, for the Context Bands of the records that follow it. */
  partialFileName: string;
}

export type ChatRecordOutcome =
  | { kind: 'record'; record: ChatRecord }
  /**
   * The run failed part-way, after capturing at least one whole message:
   * `record` is a Partial Chat Record of everything up to the last complete
   * message, and `continuation` says where a Continuation would pick up.
   */
  | { kind: 'partial'; record: ChatRecord; continuation: ContinuationPoint; reason: FailureReason; detail: string }
  /** The requested Date Range has no messages; nothing was made. */
  | { kind: 'no-messages'; from: LocalDay; to: LocalDay }
  /** A Full Chat was requested but WhatsApp Web has no messages in the Chat; nothing was made. */
  | { kind: 'empty-chat' }
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
  /** Whether the record has been cancelled. */
  cancelled: () => boolean;
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
    cancelled: () => signal?.aborted ?? false,
  };
  try {
    run.checkpoint();
    const outcome = request.kind === 'visible' ? await recordVisible(run) : await recordDays(run, request);
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
  const { devicePixelRatio } = screenshot;
  const slice = await cutSlice(screenshot.bitmap, area, devicePixelRatio, 0, area.height, 0);
  const span = visibleChatSpan(takenAt);
  const stitched = { slices: [slice], area, devicePixelRatio, rows: area.height, pageBreaks: new Set<number>() };
  return { kind: 'record', record: await finishRecord({ chatName, span, takenAt, stitched, checkpoint: run.checkpoint }) };
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
  /** WhatsApp Web ran out of older messages before the requested start. */
  historyIncomplete?: boolean;
  /** Extra Context Band lines, for example about incomplete history. */
  notes?: string[];
  /** Marks the file name of a Partial Chat Record or a Gap Record. */
  mark?: 'partial' | 'gap';
  /** Throws if the record was cancelled; checked before and while the image is made. */
  checkpoint: () => void;
}): Promise<ChatRecord> {
  const { chatName, span, takenAt, stitched, checkpoint, notes } = parts;
  const historyIncomplete = parts.historyIncomplete ?? false;
  const { area, devicePixelRatio, rows } = stitched;
  const contextBand = contextBandText({ chatName, span, takenAt, notes });
  const format = rows > maxPngChatAreaHeights * area.height ? 'pdf' : 'png';
  const fileName = chatRecordFileName(chatName, span, format, parts.mark);
  try {
    checkpoint();
    let image: Blob;
    if (format === 'png') {
      const pixels = stitchRows(stitched, { from: 0, to: rows });
      image = await withContextBand(pixels, contextBand, devicePixelRatio).convertToBlob({ type: 'image/png' });
    } else {
      const pages = pageSpans(rows, stitched.pageBreaks, area.height);
      // One page's canvas at a time: the whole record would be too tall for one.
      const images = (async function* () {
        for (const [index, page] of pages.entries()) {
          checkpoint();
          const pixels = stitchRows(stitched, page);
          yield index === 0 ? withContextBand(pixels, contextBand, devicePixelRatio) : pixels;
        }
      })();
      image = await pdfOfImages(images, { devicePixelRatio, title: fileName.replace(/\.pdf$/, ''), createdAt: takenAt });
    }
    return { chatName, format, image, fileName, span, takenAt, contextBand, historyIncomplete };
  } finally {
    closeSlices(stitched.slices);
  }
}

function closeSlices(slices: Slice[]): void {
  for (const slice of slices) slice.bitmap.close();
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

/**
 * How many times in a row to scroll again when WhatsApp Web has shifted the
 * list so that the screen lands below where the Chat Record continues.
 */
const maxMissedScrolls = 3;

/** Upper bound on scroll stops, so a page that never settles cannot loop forever. */
const maxScrollStops = 10_000;

/**
 * Days before and after every real day, so a Full Chat is the Date Range
 * between them: its start is never reached, so every older message is loaded.
 */
const beforeEveryDay: LocalDay = '0000-00-00';
const afterEveryDay: LocalDay = '9999-99-99';

async function recordDays(run: Run, request: RangeRequest): Promise<ChatRecordOutcome> {
  const { page } = run;
  const fullChat = request.kind === 'full-chat';
  const { from, to } = fullChat ? { from: beforeEveryDay, to: afterEveryDay } : request;
  const noMessages: ChatRecordOutcome = fullChat ? { kind: 'empty-chat' } : { kind: 'no-messages', from, to };
  const chatName = page.chatName();
  const area = page.chatArea();
  const takenAt = run.clock();

  const start = await scrollToFirstDivider(run, from, area.height);
  if (!start || start.divider.day > to) return noMessages;
  const first = start.divider;
  const historyIncomplete = !fullChat && !start.startReached;
  const notes = fullChat
    ? [`Full Chat; earliest available ${first.day}`]
    : historyIncomplete
      ? [`Requested from ${from}; earliest available ${first.day}`]
      : [];

  const walked = newWalked();
  const failure = await walkCatching(run, area, dividerStart(first), { kind: 'day', to }, walked);
  const record = { run, chatName, takenAt, area, walked, notes, historyIncomplete, spanFrom: first.day };
  if (failure) return partialRecord({ ...record, request, error: failure.error });
  if (!walked.lastInRange) {
    closeSlices(walked.slices);
    return noMessages;
  }
  return { kind: 'record', record: await wholeRecord(record) };
}

/** The parts of a Chat Record that a walk does not know. */
interface RecordParts {
  run: Run;
  chatName: string;
  takenAt: Date;
  area: Rect;
  walked: Walked;
  /** The first day the record covers. */
  spanFrom: LocalDay;
  /** Context Band lines beyond the standard ones. */
  notes: string[];
  historyIncomplete?: boolean;
}

/** A Chat Record of everything a finished walk covered. */
async function wholeRecord(parts: RecordParts & { mark?: 'gap' }): Promise<ChatRecord> {
  const { run, walked, area } = parts;
  const last = walked.lastInRange!;
  const stitched = { slices: walked.slices, area, devicePixelRatio: walked.devicePixelRatio, rows: last.row, pageBreaks: walked.pageBreaks };
  return finishRecord({ ...parts, span: { from: parts.spanFrom, to: last.day }, stitched, checkpoint: run.checkpoint });
}

/**
 * A Partial Chat Record of a walk that failed with `error`: everything up to
 * the bottom of the last message captured in full, with a note on why it
 * stopped, and where a Continuation of `request` would pick up. Rethrows
 * `error` when no message was captured in full.
 */
async function partialRecord(parts: RecordParts & { request: RangeRequest; error: unknown }): Promise<ChatRecordOutcome> {
  const { run, walked, area, error } = parts;
  const last = walked.lastComplete;
  if (!last) {
    closeSlices(walked.slices);
    throw error;
  }
  const reason = failureReason(error);
  const detail = errorMessage(error);
  const lastMessage = { id: last.id, day: last.day, ...(last.time ? { time: last.time } : {}) };
  const note = `Partial: stopped after ${describeMessage(lastMessage)}, run failed: ${detail}`;
  const stitched = { slices: walked.slices, area, devicePixelRatio: walked.devicePixelRatio, rows: last.row, pageBreaks: walked.pageBreaks };
  const record = await finishRecord({
    ...parts,
    span: { from: parts.spanFrom, to: last.day },
    stitched,
    notes: [...parts.notes, note],
    mark: 'partial',
    checkpoint: run.checkpoint,
  });
  const continuation: ContinuationPoint = {
    chatName: parts.chatName,
    request: parts.request,
    lastMessage,
    reason,
    partialFileName: record.fileName,
  };
  return { kind: 'partial', record, continuation, reason, detail };
}

/** "2026-11-02 14:32", or just the day when the time is not known. */
function describeMessage(message: { day: LocalDay; time?: string }): string {
  return message.time ? `${message.day} ${message.time}` : message.day;
}

/** Where a walk starts: which content position is record row 0, and what is known above it. */
interface WalkStart {
  /** The content position of record row 0, as read at the last stop. */
  origin: number;
  /** Record rows of rows at or above row 0 that are fixed, by `itemKey`; one must still be loaded at the first stop. */
  anchors: Map<string, number>;
  /** Record rows of date dividers at or above row 0, by day. */
  dividerRows: Map<LocalDay, number>;
}

/** Starts a walk at the top of a date divider. */
function dividerStart(divider: DateDivider): WalkStart {
  return {
    origin: divider.top,
    anchors: new Map([[itemKey(divider), 0]]),
    dividerRows: new Map([[divider.day, 0]]),
  };
}

/** Where a walk ends: after the last message of day `to`. */
type WalkEnd = { kind: 'day'; to: LocalDay };

/** What a walk has captured so far, kept up to date so it can still be used when the walk fails part-way. */
interface Walked {
  slices: Slice[];
  devicePixelRatio: number;
  /** Record rows where a PDF page may start: the tops of messages and date dividers. */
  pageBreaks: Set<number>;
  /** The bottom row and day of the last message in range seen so far, captured or not. */
  lastInRange?: { row: number; day: LocalDay };
  /** The last message in range captured in full, with the record row of its bottom. */
  lastComplete?: { id: string; day: LocalDay; time?: string; row: number };
}

function newWalked(): Walked {
  return { slices: [], devicePixelRatio: 1, pageBreaks: new Set() };
}

/** Walks as `walk` does; resolves with the error if it failed (not if it was cancelled, which still throws). */
async function walkCatching(
  run: Run,
  area: Rect,
  start: WalkStart,
  end: WalkEnd,
  walked: Walked,
): Promise<{ error: unknown } | undefined> {
  try {
    await walk(run, area, start, end, walked);
    return undefined;
  } catch (error) {
    if (error instanceof Cancelled || run.cancelled()) {
      closeSlices(walked.slices);
      throw new Cancelled();
    }
    return { error };
  }
}

/**
 * Walks down the Chat one chat-area height at a time from `start`, capturing
 * every screen into `walked`, until `end`.
 *
 * Content positions shift between stops (WhatsApp Web keeps only a window of
 * the list loaded, adding and dropping rows at either end), so everything is
 * kept relative to row 0 ("record rows") and re-anchored at every stop on a
 * row whose top has been captured.
 */
async function walk(run: Run, area: Rect, start: WalkStart, end: WalkEnd, walked: Walked): Promise<void> {
  const { page, camera } = run;
  const { to } = end;
  const dividerRows = new Map(start.dividerRows);
  /**
   * The record rows of the tops of rows already captured, by `itemKey`. Only
   * these are fixed points: a row further down may move when a long message
   * above it is expanded, but everything above a captured top was expanded
   * when it was on screen.
   */
  const capturedTops = new Map(start.anchors);
  const { pageBreaks, slices } = walked;
  let origin = start.origin;
  let endKnown = false;
  let covered = 0;
  /** Scrolls in a row that landed below where the Chat Record continues. */
  let missedScrolls = 0;

  await page.scrollTo(origin);
  for (let stop = 0; ; stop++) {
    run.checkpoint();
    if (stop >= maxScrollStops) throw new Error('WhatsApp Web did not stop scrolling');
    await expandReadMoreOnScreen(page, area.height);
    const items = page.loadedItems();
    origin = anchoredOrigin(items, capturedTops);

    /** The messages in range at this stop, in record rows. */
    const inRange: { item: Extract<ChatItem, { kind: 'message' }>; top: number; bottom: number; day: LocalDay }[] = [];
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
      if (day > to) continue;
      inRange.push({ item, top, bottom, day });
      if (!walked.lastInRange || bottom > walked.lastInRange.row) walked.lastInRange = { row: bottom, day };
    }

    const scrollTop = page.scrollTop();
    const atBottom = scrollTop + area.height >= page.scrollHeight() - 1;
    if (atBottom) endKnown = true;
    const visibleFrom = scrollTop - origin;
    const visibleTo = visibleFrom + area.height;
    const endRow = endKnown ? (walked.lastInRange?.row ?? 0) : Infinity;

    if (visibleFrom > covered) {
      // WhatsApp Web shifted the list after the scroll target was worked out
      // (from positions read before it settled): scroll again from the
      // positions just re-anchored.
      missedScrolls += 1;
      if (missedScrolls > maxMissedScrolls) {
        throw new Error('WhatsApp Web did not scroll to where the Chat Record continues');
      }
      await page.scrollTo(origin + covered - captureOverlap);
      continue;
    }
    missedScrolls = 0;
    if (covered < Math.min(visibleTo, endRow)) {
      const screenshot = await camera.capture();
      run.checkpoint();
      walked.devicePixelRatio = screenshot.devicePixelRatio;
      const sliceTo = Math.min(visibleTo, endRow);
      slices.push(await cutSlice(screenshot.bitmap, area, walked.devicePixelRatio, covered, sliceTo, visibleFrom));
      covered = sliceTo;
      for (const { item, bottom, day: messageDay } of inRange) {
        if (bottom > covered || (walked.lastComplete && bottom <= walked.lastComplete.row)) continue;
        walked.lastComplete = { id: item.id, day: messageDay, row: bottom, ...(item.time ? { time: item.time } : {}) };
      }
      run.onProgress({ screensCaptured: slices.length, reachedDay: dayAt(dividerRows, covered - 1) });
    }
    for (const item of items) {
      const top = item.top - origin;
      if (top >= 0 && top <= covered) capturedTops.set(itemKey(item), top);
    }
    if (endKnown && covered >= endRow) return;
    if (atBottom) throw new Error('WhatsApp Web stopped scrolling before the end of the range');
    await page.scrollTo(origin + covered - captureOverlap);
  }
}

/**
 * Shows every long message on screen in full, so a scroll stop is read and
 * captured with "Read more" expanded. WhatsApp Web only keeps the messages
 * near the screen loaded, so this happens stop by stop rather than for the
 * whole range up front. Rows already captured were expanded when they were
 * on screen, so only rows below them move; positions read before this call
 * are stale.
 */
async function expandReadMoreOnScreen(page: WhatsAppPage, height: number): Promise<void> {
  const top = page.scrollTop();
  await page.expandReadMore({ top, bottom: top + height });
}

type DateDivider = Extract<ChatItem, { kind: 'date-divider' }>;

/** Names a row of the message list, the same at every scroll stop. */
function itemKey(item: ChatItem): string {
  return item.kind === 'date-divider' ? `divider ${item.day}` : `message ${item.id}`;
}

/**
 * The content position of record row 0 at this stop, from the loaded row
 * nearest the screen whose top has been captured (`capturedTops`). Fails when
 * WhatsApp Web no longer has any of them loaded, since the record could not
 * then continue seamlessly.
 */
function anchoredOrigin(items: ChatItem[], capturedTops: Map<string, number>): number {
  let anchor: { top: number; row: number } | undefined;
  for (const item of items) {
    const row = capturedTops.get(itemKey(item));
    if (row !== undefined && (!anchor || row > anchor.row)) anchor = { top: item.top, row };
  }
  if (!anchor) throw new Error('WhatsApp Web no longer shows any part of the Chat Record captured so far');
  return anchor.top - anchor.row;
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
 * Scrolls (loading older messages as needed) until the date divider of the
 * first day on or after `from` is loaded, and returns it (in content
 * positions read at the last stop), or undefined if no day on or after
 * `from` has messages. `startReached` is false when WhatsApp Web ran out of
 * older messages before `from`, so the divider is the earliest available.
 */
async function scrollToFirstDivider(
  run: Run,
  from: LocalDay,
  step: number,
): Promise<{ divider: DateDivider; startReached: boolean } | undefined> {
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
    // day's divider is loaded above it, or when it is `from`'s own divider.
    if (index > 0 || (index === 0 && (goingDown || (atTop && dividers[0]!.day === from)))) {
      return { divider: dividers[index]!, startReached: true };
    }
    if (index === -1 && dividers.length > 0) goingDown = true;
    if (goingDown) {
      if (atBottom) return undefined;
      await page.scrollTo(scrollTop + step);
    } else if (atTop) {
      const older = await page.loadOlder();
      run.checkpoint();
      if (older === 'loaded') continue;
      if (index === 0) return { divider: dividers[0]!, startReached: false };
      if (sawMessages) throw new PageNotRecognisedError('no date dividers in the message list');
      return undefined;
    } else {
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
