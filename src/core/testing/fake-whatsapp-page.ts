import type { ChatItem, LocalDay, Rect, WhatsAppPage } from '../whatsapp-page';

/** One day of a scripted Chat: its date divider, then messages of the given pixel heights. */
export interface FakeChatDay {
  day: LocalDay;
  messageHeights: number[];
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
 */
export function createFakeWhatsAppPage(options: {
  chatName: string;
  chatArea: Rect;
  chat?: FakeChatDay[];
  olderMessages?: FakeChatDay[];
}): WhatsAppPage {
  let items: ChatItem[] = [];
  let scrollHeight = 0;
  let olderMessages = options.olderMessages ?? [];
  const lay = (chat: FakeChatDay[]) => {
    items = [];
    let y = 0;
    for (const { day, messageHeights } of chat) {
      items.push({ kind: 'date-divider', day, top: y, bottom: y + fakeDividerHeight });
      y += fakeDividerHeight;
      for (const height of messageHeights) {
        items.push({ kind: 'message', top: y, bottom: y + height });
        y += height;
      }
    }
    scrollHeight = Math.max(y, options.chatArea.height);
  };
  let chat = options.chat ?? [];
  lay(chat);
  const maxScrollTop = () => scrollHeight - options.chatArea.height;
  let scrollTop = maxScrollTop();

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
  };
}
