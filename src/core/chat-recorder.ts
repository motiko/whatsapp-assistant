import { CaptureNotAllowedError, type Camera } from './camera';
import { contextBandText, withContextBand } from './context-band';
import { localDayOf, type DaySpan } from './day-span';
import { PageNotRecognisedError, type Rect, type WhatsAppPage } from './whatsapp-page';

/**
 * What to record. For now only the chat area currently on screen; Date Range
 * and Full Chat requests join this union in later tickets.
 */
export type ChatRecordRequest = { kind: 'visible' };

export interface ChatRecord {
  /** The Chat this record is of. */
  chatName: string;
  format: 'png';
  /** The Context Band above WhatsApp Web's own pixels, encoded as `format`. */
  image: Blob;
  /** The days the Chat Record covers. */
  span: DaySpan;
  /** When the Chat Record was taken. */
  takenAt: Date;
  /** The Context Band's text, one entry per line. */
  contextBand: string[];
}

export type ChatRecordOutcome =
  | { kind: 'record'; record: ChatRecord }
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

export function createChatRecorder(deps: ChatRecorderDeps): ChatRecorder {
  const clock = deps.clock ?? (() => new Date());
  return {
    async record() {
      try {
        return await recordVisible({ ...deps, clock });
      } catch (error) {
        return { kind: 'failed', reason: failureReason(error), detail: errorMessage(error) };
      }
    },
  };
}

async function recordVisible(deps: Required<ChatRecorderDeps>): Promise<ChatRecordOutcome> {
  const chatName = deps.page.chatName();
  const area = deps.page.chatArea();
  const takenAt = deps.clock();
  const screenshot = await deps.camera.capture();
  const pixels = crop(screenshot.bitmap, area, screenshot.devicePixelRatio);
  const span = visibleChatSpan(takenAt);
  const contextBand = contextBandText({ chatName, span, takenAt });
  const withBand = withContextBand(pixels, contextBand, screenshot.devicePixelRatio);
  const image = await withBand.convertToBlob({ type: 'image/png' });
  return { kind: 'record', record: { chatName, format: 'png', image, span, takenAt, contextBand } };
}

/**
 * The days a record of the visible chat covers. The recorder does not read
 * the dates of the messages on screen yet, so this is the day the record was
 * taken; Date Range requests (#5) replace it with the span actually captured.
 */
function visibleChatSpan(takenAt: Date): DaySpan {
  const today = localDayOf(takenAt);
  return { from: today, to: today };
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
