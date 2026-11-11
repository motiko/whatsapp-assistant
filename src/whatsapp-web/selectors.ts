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
  /** The list of messages and date dividers, inside the conversation pane. */
  messageList: '#main [role="application"]',
  /** Each item of the message list: a date divider, a message, or another row (e.g. an unread banner). */
  messageListRow: '[role="row"]',
  /** Present inside a row that is a message (its id names the Chat and the message). */
  message: '[data-id]',
  /** The "Read more" button inside a message WhatsApp Web shows cut short. */
  readMore: '.read-more-button',
} as const;
