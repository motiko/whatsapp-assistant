/**
 * Every CSS selector this extension uses on WhatsApp Web, in one place.
 *
 * WhatsApp Web's class names are generated and change often, so these rely
 * on ids, element types, roles and ARIA attributes instead. When a WhatsApp
 * update breaks the extension, fix the selectors here and refresh the
 * snapshots in `fixtures/` (see its README).
 */
export const selectors = {
  /** The conversation pane of the open Chat (absent when no Chat is open). */
  conversationPane: '#main',
  /** The open Chat's header bar, inside the conversation pane. */
  chatHeader: '#main header',
  /** Text spans in the Chat header; the first non-empty one is the Chat's name. */
  chatHeaderText: 'span[dir="auto"]',
  /*
   * The message list has no role or id of its own: it is the content of the
   * conversation pane's tallest scrolling element, and each of its children
   * is one item — a message, a date divider, or something else (an unread
   * banner, the older-messages prompt). Messages hold a `[role="row"]`; date
   * dividers do not. (Checked against the real page, Nov 2026.)
   */
  /** Present inside a row that is a message (its id names the Chat and the message). */
  message: '[data-id]',
  /**
   * Inside a text message: the element whose `data-pre-plain-text` starts with
   * the message's time, "[14:32, 11/11/2026] Name: ". Only the time is read.
   * Media without a caption may not have one. (Unverified against the real page.)
   */
  messageTimestamp: '[data-pre-plain-text]',
  /** The "Read more" button inside a message WhatsApp Web shows cut short. */
  readMore: '.read-more-button',
  /**
   * Clickable elements in the message scroller; one whose text matches
   * `olderMessagesPromptText` is the prompt to get older messages from the
   * phone. On the real page it is a <button> above the message list, not an
   * item in it (checked Nov 2026).
   */
  promptButton: 'button, [role="button"]',
} as const;

/**
 * The text of WhatsApp Web's prompt at the top of the message list, "Click
 * here to get older messages from your phone." Matched by text because the
 * row has no stable attribute we know of; English only for now.
 */
export const olderMessagesPromptText = /older messages/i;
