/**
 * WhatsApp Page: the Chat Recorder's view of the Chat open in WhatsApp Web.
 *
 * The Chat Recorder knows nothing about WhatsApp Web's page structure; it
 * works only through this interface. The real adapter lives in
 * `src/whatsapp-web/`. Later tickets extend this interface (scroll position
 * and height, scrolling, loading older messages, date dividers and message
 * positions, expanding "Read more") rather than replacing it.
 *
 * Any method may throw `PageNotRecognisedError` when the page no longer
 * matches what the adapter expects (for example after a WhatsApp update).
 */
export interface WhatsAppPage {
  /** The open Chat's name, as shown in its header. */
  chatName(): string;
  /**
   * Where the chat area (the scrolling message list, without the Chat list,
   * the Chat header or the message box) is on screen, in CSS pixels relative
   * to the visible viewport.
   */
  chatArea(): Rect;
}

/** A rectangle in CSS pixels. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** WhatsApp Web's page does not look the way the adapter expects. */
export class PageNotRecognisedError extends Error {
  constructor(what: string) {
    super(`WhatsApp Web's page was not recognised: ${what}`);
    this.name = 'PageNotRecognisedError';
  }
}
