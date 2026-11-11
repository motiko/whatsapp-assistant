import type { LocalDay } from '../day-span';
import type { ChatItem, Rect, WhatsAppPage } from '../whatsapp-page';

/** One day of a scripted Chat: its date divider, then messages of the given pixel heights. */
export interface FakeChatDay {
  day: LocalDay;
  messageHeights: (number | FakeLongMessage)[];
}

/**
 * A long message WhatsApp Web shows cut short behind "Read more" until it is
 * expanded. Use a distinct object for each such message.
 */
export interface FakeLongMessage {
  /** Its height while cut short, "Read more" included. */
  truncated: number;
  /** Its height once shown in full. */
  expanded: number;
}

/** A scripted WhatsApp Page, plus what a test can see on its screen. */
export interface FakeWhatsAppPage extends WhatsAppPage {
  /** Whether a message cut short behind "Read more" is (even partly) in the chat area right now. */
  readMoreOnScreen(): boolean;
}

/** Every date divider in a fake Chat is this tall (CSS px). */
export const fakeDividerHeight = 40;

/**
 * A scripted WhatsApp Page: an open Chat with a known name and layout, and a
 * timeline of days laid out top to bottom from content position 0. Each day
 * is a date divider (`fakeDividerHeight` tall) followed by its messages, with
 * no space between rows.
 *
 * Like WhatsApp Web it opens scrolled to the newest message, and only reports
 * the rows near the visible part of the list (one chat-area height above and
 * below it), so a recorder must scroll and re-read to see the whole Chat.
 * When scrolled to the very top it loads `olderMessages` above, all at once,
 * keeping the same rows on screen (so every content position shifts down).
 * Expanding a long message makes it grow downwards, moving every row below it
 * and leaving the scroll position as it was.
 */
export function createFakeWhatsAppPage(options: {
  chatName: string;
  chatArea: Rect;
  chat?: FakeChatDay[];
  olderMessages?: FakeChatDay[];
}): FakeWhatsAppPage {
  let items: ChatItem[] = [];
  /** The long messages still cut short, by their row in `items`. */
  let truncatedRows = new Map<ChatItem, FakeLongMessage>();
  const expanded = new Set<FakeLongMessage>();
  let scrollHeight = 0;
  let olderMessages = options.olderMessages ?? [];
  const lay = (chat: FakeChatDay[]) => {
    items = [];
    truncatedRows = new Map();
    let y = 0;
    for (const { day, messageHeights } of chat) {
      items.push({ kind: 'date-divider', day, top: y, bottom: y + fakeDividerHeight });
      y += fakeDividerHeight;
      for (const message of messageHeights) {
        const height = typeof message === 'number' ? message : expanded.has(message) ? message.expanded : message.truncated;
        const item: ChatItem = { kind: 'message', top: y, bottom: y + height };
        items.push(item);
        if (typeof message !== 'number' && !expanded.has(message)) truncatedRows.set(item, message);
        y += height;
      }
    }
    scrollHeight = Math.max(y, options.chatArea.height);
  };
  let chat = options.chat ?? [];
  lay(chat);
  const maxScrollTop = () => scrollHeight - options.chatArea.height;
  let scrollTop = maxScrollTop();
  const truncatedIn = (top: number, bottom: number) =>
    [...truncatedRows].filter(([item]) => item.bottom > top && item.top < bottom).map(([, message]) => message);

  return {
    chatName: () => options.chatName,
    chatArea: () => ({ ...options.chatArea }),
    scrollTop: () => scrollTop,
    scrollHeight: () => scrollHeight,
    async scrollTo(top) {
      scrollTop = Math.min(Math.max(Math.round(top), 0), maxScrollTop());
      if (scrollTop === 0 && olderMessages.length > 0) {
        const heightBefore = scrollHeight;
        chat = [...olderMessages, ...chat];
        olderMessages = [];
        lay(chat);
        scrollTop += scrollHeight - heightBefore;
      }
    },
    loadedItems() {
      const from = scrollTop - options.chatArea.height;
      const to = scrollTop + 2 * options.chatArea.height;
      return items.filter((item) => item.bottom > from && item.top < to).map((item) => ({ ...item }));
    },
    async expandReadMore(span) {
      const loadedFrom = scrollTop - options.chatArea.height;
      const loadedTo = scrollTop + 2 * options.chatArea.height;
      const top = Math.max(span.top, loadedFrom);
      const bottom = Math.min(span.bottom, loadedTo);
      for (const message of truncatedIn(top, bottom)) expanded.add(message);
      lay(chat);
    },
    readMoreOnScreen: () => truncatedIn(scrollTop, scrollTop + options.chatArea.height).length > 0,
  };
}
