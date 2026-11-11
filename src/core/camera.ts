/**
 * Camera: takes a picture of what is on screen in the WhatsApp Web tab.
 *
 * The real Camera captures the visible tab through the extension's background
 * worker and keeps the extension's own UI out of the picture. Tests use a
 * fake that generates images with known patterns.
 */
export interface Camera {
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
 * Chrome refused to capture the tab because the extension has not been given
 * access to it yet (see the README: capture needs the `activeTab` grant).
 */
export class CaptureNotAllowedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'CaptureNotAllowedError';
  }
}
