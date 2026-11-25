/**
 * A message loaded in the open Chat, as the Chat Watcher reads it. `id` is
 * WhatsApp Web's own name for it (`data-id`). `in` messages are from the
 * contact (or, in a group, from another member), `out` messages are the
 * user's own. `text` is missing for a message without text (a photo without
 * a caption, a voice note, a sticker…).
 */
export interface LoadedMessage {
  id: string;
  direction: 'in' | 'out';
  /** Who sent it, when WhatsApp Web says (it does for text messages). */
  sender?: string;
  text?: string;
  /** The extension sent it, from a Telegram reply (only ever on `out` messages). */
  sentHere?: boolean;
  /** It is a voice note; `seconds`: its length as WhatsApp Web shows it. */
  voice?: { seconds?: number };
}

/** At most this many messages are forwarded from one report; older unseen ones are dropped. */
export const maxForwardedAtOnce = 20;

/**
 * The messages to forward to the Translation Bot: the incoming ones after
 * the last message that is either already seen or the user's own (anything
 * before a reply was answered already), newest last, at most
 * `maxForwardedAtOnce`. Messages before that point are never forwarded, so
 * older history loaded by scrolling up isn't sent again.
 *
 * With `includeOwn` (test mode, for a Chat with oneself), the user's own
 * messages are forwarded too, except those the extension sent; then only
 * seen messages mark the point.
 */
export function newIncomingMessages(
  loaded: readonly LoadedMessage[],
  seen: ReadonlySet<string>,
  options: { includeOwn?: boolean } = {},
): LoadedMessage[] {
  const includeOwn = options.includeOwn === true;
  let boundary = -1;
  loaded.forEach((message, index) => {
    if (seen.has(message.id) || (!includeOwn && message.direction === 'out')) boundary = index;
  });
  return loaded
    .slice(boundary + 1)
    .filter((message) => !seen.has(message.id))
    .filter((message) => message.direction === 'in' || (includeOwn && !message.sentHere))
    .slice(-maxForwardedAtOnce);
}
