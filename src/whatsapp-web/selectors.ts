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

  /*
   * Used by auto-translation (`chats-page.ts`). None of these is verified
   * against the real page yet; they follow WhatsApp Web's structure as
   * commonly described (Nov 2026).
   */
  /** The Chat list (it also shows search results). */
  chatList: '#pane-side',
  /** A row of the Chat list; the first element with a `title` in it holds the Chat's name. */
  chatListRow: '[role="listitem"]',
  /** Fallback when the Chat list has no `listitem` rows. */
  chatListRowFallback: '[role="row"]',
  chatListTitle: 'span[title]',
  /**
   * A Chat list row's unread badge, labelled like "3 unread messages" in
   * English. In any language it is an element with an `aria-label` whose
   * text is just the number, which is how `chats-page.ts` finds it.
   */
  unreadBadge: '[aria-label*="unread" i]',
  /** Candidates for the unread badge in any language: labelled elements; the one whose text is a number is it. */
  labelled: '[aria-label]',
  /**
   * In a Chat list row: icons. Next to the last message, one means it isn't
   * plain text (a photo, voice note, sticker, deleted message…), so the
   * Chat is opened to read it. Emoji `<img>`s inside the text don't count.
   */
  rowIcon: 'svg, img, [data-icon]',
  /** The search box above the Chat list. */
  chatSearch: '#side [contenteditable="true"]',
  /**
   * Who sent a message. WhatsApp Web used to say it in the message's
   * `data-id` (`true_…` the user's own, `false_…` anyone else's) and with
   * `message-out` / `message-in` classes; since Nov 2026 `data-id` holds only
   * the message's key and the classes are gone (seen on the real page), so
   * `chats-page.ts` falls back to which side the bubble sits on.
   */
  ownIdPrefix: 'true_',
  othersIdPrefix: 'false_',
  ownMessageClass: '.message-out',
  othersMessageClass: '.message-in',
  /** Inside a message: the element with `data-pre-plain-text` ("[time, date] Sender: "), around its text. */
  messageBody: '[data-pre-plain-text]',
  /**
   * Inside a reply: the quote of the message it answers, which carries its
   * own text (and may carry its own `data-pre-plain-text`). It is clickable
   * (to jump to the quoted message), so it is a `role="button"`; older pages
   * mark its text `quoted-mention`. Text inside it is not the reply's own.
   */
  quotedMessage: '[role="button"], .quoted-mention',
  /** What a quote holds and other buttons in a message don't: a message's text (or its sender line). */
  quotedText: '[data-pre-plain-text], .selectable-text, .quoted-mention',
  /** Inside a message body: its text (or a photo's caption). Emoji are `<img alt="😀">`. */
  messageText: '.selectable-text',
  /** The open Chat's message box. */
  messageBox: '#main footer [contenteditable="true"]',
  /** The send button's icon, next to the message box once it holds text (older pages). */
  sendIcon: '#main footer [data-icon*="send"]',
  /** The send button by its label, English UI (newer pages draw the icon as a bare `<svg>`). Else Enter is pressed. */
  sendButton: '#main footer button[aria-label="Send" i], #main footer [role="button"][aria-label="Send" i]',

  /*
   * Voice notes (`chats-page.ts`, `audio-probe.ts`). Not verified against the
   * real page yet: "Diagnose a voice note" on the options page shows what it
   * has, to fix these.
   */
  /**
   * Inside a message: what marks it as a voice note: its play button's icon,
   * its progress slider, or an audio element. A video has a play icon too,
   * but no slider; it is told apart by `voiceNoteStrong`.
   */
  voiceNote: 'audio, [data-icon*="audio-play"], [data-icon*="ptt"], [role="slider"], [aria-label*="voice message" i]',
  /** The marks only a voice note has (not a video's play icon). */
  voiceNoteStrong: 'audio, [data-icon*="ptt"], [role="slider"], [aria-label*="voice message" i]',
  /** Inside a voice note: its play button (an icon inside a button), English label as a fallback. */
  voicePlayIcon: '[data-icon*="audio-play"], [data-icon*="play"]',
  voicePlayButton: 'button[aria-label*="play" i], [role="button"][aria-label*="play" i]',
  /** An audio element WhatsApp Web already gave its decrypted audio (a `blob:` URL). */
  voiceAudioElement: 'audio[src^="blob:"], audio source[src^="blob:"]',
} as const;

/**
 * The text of WhatsApp Web's prompt at the top of the message list, "Click
 * here to get older messages from your phone." Matched by text because the
 * row has no stable attribute we know of; English only for now.
 */
export const olderMessagesPromptText = /older messages/i;
