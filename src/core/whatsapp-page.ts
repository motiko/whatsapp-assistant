import type { LocalDay } from './day-span';

/**
 * WhatsApp Page: the Chat Recorder's view of the Chat open in WhatsApp Web.
 *
 * The Chat Recorder knows nothing about WhatsApp Web's page structure; it
 * works only through this interface. The real adapter lives in
 * `src/whatsapp-web/`. Later tickets extend this interface (loading older
 * messages, expanding "Read more") rather than replacing it.
 *
 * Positions in the message list are in CSS pixels from the top of the scroll
 * container's content, so they do not change when the list scrolls.
 * WhatsApp Web only keeps the messages near the visible part of the list
 * loaded, so `loadedItems` never promises the whole Chat; re-read it after
 * every `scrollTo`.
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
  /** How far the message list is scrolled: the content position shown at the chat area's top. */
  scrollTop(): number;
  /** The height of the message list's content currently loaded. */
  scrollHeight(): number;
  /**
   * Scrolls the message list so content position `top` is at the chat area's
   * top (clamped to what can be scrolled to), and resolves once WhatsApp Web
   * has settled. Read `scrollTop()` afterwards for where it actually went.
   */
  scrollTo(top: number): Promise<void>;
  /** The date dividers and messages currently loaded, in page order. */
  loadedItems(): ChatItem[];
  /**
   * Shows in full every loaded message that WhatsApp Web cuts short behind
   * "Read more" and whose row overlaps content positions `span.top` to
   * `span.bottom`, and resolves once WhatsApp Web has settled. Expanded
   * messages grow downwards, moving every row below them: re-read
   * `loadedItems()` (and `scrollHeight()`) afterwards.
   */
  expandReadMore(span: { top: number; bottom: number }): Promise<void>;
}

/** One row of the message list, with its vertical span in content pixels. */
export type ChatItem =
  /** WhatsApp Web's date divider: every message below it, up to the next divider, is from `day`. */
  | { kind: 'date-divider'; day: LocalDay; top: number; bottom: number }
  | { kind: 'message'; top: number; bottom: number };

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
