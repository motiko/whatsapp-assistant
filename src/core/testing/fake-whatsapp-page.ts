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
  /**
   * The Chat position shown at the chat area's top: where it is in the whole
   * loaded Chat, laid out from 0, whatever part of it WhatsApp Web has in the
   * message list right now. Without `windowRows` it is the same as `scrollTop()`.
   */
  chatPositionShown(): number;
}

/** Every date divider in a fake Chat is this tall (CSS px). */
export const fakeDividerHeight = 40;

/**
 * A scripted WhatsApp Page: an open Chat with a known name and layout, and a
 * timeline of days laid out top to bottom from Chat position 0. Each day is a
 * date divider (`fakeDividerHeight` tall) followed by its messages, with no
 * space between rows. Messages are named `<day> #<n>`, counting from 1.
 *
 * Like WhatsApp Web it opens scrolled to the newest message, and only reports
 * the rows near the visible part of the list (one chat-area height above and
 * below it), so a recorder must scroll and re-read to see the whole Chat.
 * When scrolled to the very top it loads `olderMessages` above, all at once,
 * keeping the same rows on screen (so every content position shifts down).
 * `olderMessagesOnPhone` load the same way, but only through `loadOlder`
 * (like WhatsApp Web's "get older messages from your phone" prompt, which
 * scrolling alone doesn't click). Nothing older than those can be loaded:
 * the earliest of them, or of `chat`, is the earliest loadable day.
 * Expanding a long message makes it grow downwards, moving every row below it
 * and leaving the scroll position as it was.
 *
 * With `windowRows`, it behaves like WhatsApp Web's sliding window: only that
 * many rows are in the message list at once, and content position 0 is the
 * top of the first of them. A scroll that ends less than a chat-area height
 * from either end of the list brings in a quarter of `windowRows` more rows at
 * that end and drops as many at the other (but never rows on screen), keeping the same rows on screen: rows added or
 * dropped above shift every content position, and the scroll position with
 * them. Pixels a fake Camera captures carry Chat positions
 * (`chatPositionShown`), so a stitched record still reads back as one run of
 * Chat rows.
 */
export function createFakeWhatsAppPage(options: {
  chatName: string;
  chatArea: Rect;
  chat?: FakeChatDay[];
  olderMessages?: FakeChatDay[];
  olderMessagesOnPhone?: FakeChatDay[];
  /** How many rows WhatsApp Web keeps in the message list at once; all of them when absent. */
  windowRows?: number;
}): FakeWhatsAppPage {
  const height = options.chatArea.height;
  const windowRows = options.windowRows ?? Infinity;
  /** Every row of the loaded Chat, in Chat positions. */
  let rows: ChatItem[] = [];
  /** The long messages still cut short, by their row in `rows`. */
  let truncatedRows = new Map<ChatItem, FakeLongMessage>();
  const expanded = new Set<FakeLongMessage>();
  let olderMessages = options.olderMessages ?? [];
  let olderMessagesOnPhone = options.olderMessagesOnPhone ?? [];
  const lay = (chat: FakeChatDay[]) => {
    rows = [];
    truncatedRows = new Map();
    let y = 0;
    for (const { day, messageHeights } of chat) {
      rows.push({ kind: 'date-divider', day, top: y, bottom: y + fakeDividerHeight });
      y += fakeDividerHeight;
      for (const [index, message] of messageHeights.entries()) {
        const rowHeight =
          typeof message === 'number' ? message : expanded.has(message) ? message.expanded : message.truncated;
        const item: ChatItem = { kind: 'message', id: `${day} #${index + 1}`, top: y, bottom: y + rowHeight };
        rows.push(item);
        if (typeof message !== 'number' && !expanded.has(message)) truncatedRows.set(item, message);
        y += rowHeight;
      }
    }
  };
  let chat = options.chat ?? [];
  lay(chat);
  /** The rows in the message list: `rows[first]` up to, not including, `rows[last]`. */
  let last = rows.length;
  let first = Math.max(0, last - windowRows);
  /** The Chat position of content position 0. */
  const windowTop = () => rows[first]?.top ?? 0;
  const scrollHeight = () => Math.max(last > first ? rows[last - 1]!.bottom - windowTop() : 0, height);
  const maxScrollTop = () => scrollHeight() - height;
  let scrollTop = maxScrollTop();
  const truncatedIn = (top: number, bottom: number) =>
    [...truncatedRows].filter(([item]) => item.bottom > top && item.top < bottom).map(([, message]) => message);
  /** The rows reported as loaded, in Chat positions: those in the list near the screen. */
  const nearScreen = () => {
    const from = windowTop() + scrollTop - height;
    const to = windowTop() + scrollTop + 2 * height;
    return rows.slice(first, last).filter((item) => item.bottom > from && item.top < to);
  };
  /** Moves the start of the list to `rows[index]`, keeping the same rows on screen. */
  const moveFirst = (index: number) => {
    const before = windowTop();
    first = index;
    scrollTop += before - windowTop();
  };
  /** Slides the list along when the screen is near one of its ends; whether rows were added above. */
  const slide = () => {
    if (windowRows === Infinity) return false;
    const step = Math.max(1, Math.floor(windowRows / 4));
    const screenTop = windowTop() + scrollTop;
    if (scrollTop < height && first > 0) {
      moveFirst(Math.max(0, first - step));
      while (last - first > windowRows && rows[last - 1]!.top >= screenTop + height) last -= 1;
      return true;
    }
    if (scrollHeight() - scrollTop - height < height && last < rows.length) {
      last = Math.min(rows.length, last + step);
      let drop = first;
      while (last - drop > windowRows && rows[drop]!.bottom <= screenTop) drop += 1;
      moveFirst(drop);
    }
    return false;
  };
  /** Adds `older` above the loaded Chat, keeping the same rows on screen. */
  const prepend = (older: FakeChatDay[]) => {
    const rowsBefore = rows.length;
    const screenTop = windowTop() + scrollTop;
    const heightBefore = rows.at(-1)?.bottom ?? 0;
    chat = [...older, ...chat];
    lay(chat);
    const added = rows.length - rowsBefore;
    const shift = (rows.at(-1)?.bottom ?? 0) - heightBefore;
    // The older rows join the list at its top.
    last += added;
    while (last - first > windowRows && rows[last - 1]!.top >= screenTop + shift + height) last -= 1;
    scrollTop = screenTop + shift - windowTop();
  };
  /** Scrolls to `top`; whether rows were added above. */
  const scrollTo = (top: number) => {
    scrollTop = Math.min(Math.max(Math.round(top), 0), maxScrollTop());
    if (slide()) return true;
    if (scrollTop === 0 && first === 0 && olderMessages.length > 0) {
      prepend(olderMessages);
      olderMessages = [];
      return true;
    }
    return false;
  };
  const toContent = (item: ChatItem): ChatItem => ({ ...item, top: item.top - windowTop(), bottom: item.bottom - windowTop() });

  return {
    chatName: () => options.chatName,
    chatArea: () => ({ ...options.chatArea }),
    scrollTop: () => scrollTop,
    scrollHeight,
    async scrollTo(top) {
      scrollTo(top);
    },
    async loadOlder() {
      if (scrollTo(0)) return 'loaded';
      if (olderMessagesOnPhone.length === 0) return 'no-older-messages';
      prepend(olderMessagesOnPhone);
      olderMessagesOnPhone = [];
      return 'loaded';
    },
    loadedItems: () => nearScreen().map(toContent),
    async expandReadMore(span) {
      const top = windowTop() + span.top;
      const bottom = windowTop() + span.bottom;
      for (const item of nearScreen()) {
        if (item.bottom <= top || item.top >= bottom) continue;
        const message = truncatedRows.get(item);
        if (message) expanded.add(message);
      }
      lay(chat);
    },
    readMoreOnScreen: () => truncatedIn(windowTop() + scrollTop, windowTop() + scrollTop + height).length > 0,
    chatPositionShown: () => windowTop() + scrollTop,
  };
}
