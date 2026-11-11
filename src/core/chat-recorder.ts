import { CaptureNotAllowedError, type Camera } from './camera';
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
  /** WhatsApp Web's own pixels, encoded as `format`. */
  image: Blob;
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

export function createChatRecorder(deps: { page: WhatsAppPage; camera: Camera }): ChatRecorder {
  return {
    async record() {
      try {
        return await recordVisible(deps);
      } catch (error) {
        return { kind: 'failed', reason: failureReason(error), detail: errorMessage(error) };
      }
    },
  };
}

async function recordVisible(deps: { page: WhatsAppPage; camera: Camera }): Promise<ChatRecordOutcome> {
  const chatName = deps.page.chatName();
  const area = deps.page.chatArea();
  const screenshot = await deps.camera.capture();
  const image = await cropToPng(screenshot.bitmap, area, screenshot.devicePixelRatio);
  return { kind: 'record', record: { chatName, format: 'png', image } };
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
