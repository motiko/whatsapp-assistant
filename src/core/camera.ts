/**
 * Camera: takes a picture of what is on screen in the WhatsApp Web tab.
 *
 * The real Camera captures the tab through the extension's background worker,
 * also while the tab is in the background, and keeps the extension's own UI
 * out of the picture. Tests use a fake that generates images with known
 * patterns.
 */
export interface Camera {
  /**
   * Gets ready to capture for one Chat Record. Called once, before WhatsApp
   * Web is touched; rejects if the tab can't be captured.
   */
  start?(): Promise<void>;
  /** Called once when that Chat Record ends, however it ends, if `start` succeeded. */
  stop?(): Promise<void>;
  /**
   * The visible viewport's pixels. `bitmap` covers the whole viewport in
   * device pixels; `devicePixelRatio` converts CSS pixels to bitmap pixels.
   * Rejects if the screen could not be captured.
   */
  capture(): Promise<Screenshot>;
}

export interface Screenshot {
  bitmap: ImageBitmap;
  devicePixelRatio: number;
}

/**
 * Chrome refused to let the extension capture the tab (for example it could
 * not attach its debugger to it; see docs/adr/0004).
 */
export class CaptureNotAllowedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'CaptureNotAllowedError';
  }
}
