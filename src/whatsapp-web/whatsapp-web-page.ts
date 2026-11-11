import { PageNotRecognisedError, type ChatItem, type Rect, type WhatsAppPage } from '../core/whatsapp-page';
import { readDividerDay } from './divider-dates';
import { olderMessagesPromptText, selectors } from './selectors';

export interface WhatsAppWebPageOptions {
  /** Now, for reading "Today", "Yesterday" and weekday dividers. Defaults to the clock. */
  today?: () => Date;
  /** The language WhatsApp Web shows dates in. Defaults to the browser's. */
  locale?: string;
  /**
   * How long the message list must stay the same height after a scroll
   * before it counts as settled (WhatsApp Web renders and loads messages
   * after scrolling). Defaults to 300 ms.
   */
  settleMs?: number;
  /**
   * How long to wait for older messages to appear after scrolling to the top
   * of the message list or clicking the prompt to get them from the phone,
   * before concluding there are none. Defaults to 5000 ms.
   */
  olderMessagesWaitMs?: number;
}

/**
 * The real WhatsApp Page: reads the Chat open in WhatsApp Web's page.
 * The only module (with `selectors.ts`, `divider-dates.ts` and
 * `chat-header.ts`) that knows WhatsApp Web's page structure.
 */
export function createWhatsAppWebPage(doc: Document, options: WhatsAppWebPageOptions = {}): WhatsAppPage {
  const today = options.today ?? (() => new Date());
  const locale = options.locale ?? doc.defaultView?.navigator.language ?? 'en';
  const settleMs = options.settleMs ?? 300;
  const olderMessagesWaitMs = options.olderMessagesWaitMs ?? 5000;
  return {
    chatName() {
      const header = find(doc, selectors.chatHeader, 'the Chat header');
      const spans = Array.from(header.querySelectorAll(selectors.chatHeaderText));
      const name = spans.map((span) => span.textContent?.trim() ?? '').find((text) => text !== '');
      if (!name) throw new PageNotRecognisedError("the Chat's name in its header");
      return name;
    },
    chatArea() {
      const scroller = messageScroller(doc);
      const box = scroller.getBoundingClientRect();
      // The client box leaves out borders and the scrollbar, so only messages remain.
      const area = {
        left: box.left + scroller.clientLeft,
        top: box.top + scroller.clientTop,
        width: scroller.clientWidth,
        height: scroller.clientHeight,
      };
      return clipToViewport(area, doc);
    },
    scrollTop: () => messageScroller(doc).scrollTop,
    scrollHeight: () => messageScroller(doc).scrollHeight,
    async scrollTo(top) {
      const scroller = messageScroller(doc);
      scroller.scrollTop = top;
      await settle(doc.defaultView!, scroller, settleMs);
    },
    loadedItems() {
      const now = today();
      const items: ChatItem[] = [];
      for (const { row, span } of listRows(doc)) {
        const message = row.querySelector(selectors.message);
        if (message) {
          const id = message.getAttribute('data-id');
          if (!id) throw new PageNotRecognisedError('a message without its id (data-id)');
          const time = messageTime(message);
          items.push(time ? { kind: 'message', id, time, ...span } : { kind: 'message', id, ...span });
          continue;
        }
        const day = readDividerDay(row.textContent?.trim() ?? '', now, locale);
        if (day) items.push({ kind: 'date-divider', day, ...span });
      }
      return items;
    },
    async expandReadMore(span) {
      const clicked = new WeakSet<Element>();
      for (let round = 0; round < maxReadMoreRounds; round++) {
        const buttons = listRows(doc).flatMap(({ row, span: rowSpan }) =>
          rowSpan.bottom > span.top && rowSpan.top < span.bottom
            ? Array.from(row.querySelectorAll<HTMLElement>(selectors.readMore))
            : [],
        );
        if (buttons.length === 0) return;
        // A button already clicked is still waiting for WhatsApp Web to expand its message.
        for (const button of buttons) {
          if (clicked.has(button)) continue;
          clicked.add(button);
          button.click();
        }
        await settle(doc.defaultView!, messageScroller(doc), settleMs);
      }
      throw new PageNotRecognisedError('"Read more" did not show the rest of a message');
    },
    async loadOlder() {
      const scroller = messageScroller(doc);
      const view = doc.defaultView!;
      const oldestBefore = oldestMessage(doc);
      const olderArrived = () => oldestMessage(doc) !== oldestBefore;
      const waitForOlder = async () => {
        if (!(await waitFor(view, olderArrived, olderMessagesWaitMs))) return false;
        await settle(view, scroller, settleMs);
        return true;
      };
      // WhatsApp Web loads older messages on its own when scrolled to the top.
      scroller.scrollTop = 0;
      if (await waitForOlder()) return 'loaded';
      // Beyond what it keeps, it asks to get older messages from the phone.
      const prompt = olderMessagesPrompt(doc);
      if (!prompt) return 'no-older-messages';
      prompt.click();
      return (await waitForOlder()) ? 'loaded' : 'no-older-messages';
    },
  };
}

/**
 * How many times to look for "Read more" again after expanding: WhatsApp Web
 * may show a very long message in several steps, each with its own "Read more".
 */
const maxReadMoreRounds = 20;

/**
 * The time of day a message shows, read from the start of its
 * `data-pre-plain-text` ("[14:32, 11/11/2026] Name: "). Only the time is
 * taken; the date, sender and text are not read.
 */
function messageTime(message: Element): string | undefined {
  const label = message.querySelector(selectors.messageTimestamp)?.getAttribute('data-pre-plain-text') ?? '';
  return /^\[([^,\]]+),/.exec(label)?.[1]?.trim() || undefined;
}

/** Every item of the message list, with its vertical span in content positions. */
function listRows(doc: Document): { row: Element; span: { top: number; bottom: number } }[] {
  const scroller = messageScroller(doc);
  const list = messageList(doc);
  // Content position 0 is the top of the scroll container's content.
  const origin = scroller.getBoundingClientRect().top + scroller.clientTop - scroller.scrollTop;
  return Array.from(list.children, (row) => {
    const box = row.getBoundingClientRect();
    return { row, span: { top: box.top - origin, bottom: box.bottom - origin } };
  });
}

/**
 * The oldest message loaded (its `data-id`, which names it). WhatsApp Web may
 * unload newer messages as it loads older ones, so a new oldest message, not
 * the list's height, tells that older ones arrived.
 */
function oldestMessage(doc: Document): string | undefined {
  const list = messageList(doc);
  return list.querySelector(selectors.message)?.getAttribute('data-id') ?? undefined;
}

/** Polls `condition` each frame (or `frameFallbackMs`) for up to `waitMs`; resolves whether it became true. */
async function waitFor(view: Window, condition: () => boolean, waitMs: number): Promise<boolean> {
  const deadline = view.performance.now() + waitMs;
  for (;;) {
    await nextFrame(view);
    await new Promise((resolve) => view.setTimeout(resolve, 10));
    if (condition()) return true;
    if (view.performance.now() >= deadline) return false;
  }
}

/**
 * WhatsApp Web's "get older messages from your phone" prompt, if it shows one.
 * On the real page it is a button above the message list, inside the
 * scroller; it is looked for anywhere in the scroller except inside messages.
 */
function olderMessagesPrompt(doc: Document): HTMLElement | undefined {
  for (const button of messageScroller(doc).querySelectorAll<HTMLElement>(selectors.promptButton)) {
    if (button.closest(selectors.message)) continue;
    if (olderMessagesPromptText.test(button.textContent ?? '')) return button;
  }
  return undefined;
}

/** Resolves once the list has been painted and its height has stopped changing. */
async function settle(view: Window, scroller: HTMLElement, settleMs: number): Promise<void> {
  for (let round = 0; round < 20; round++) {
    const height = scroller.scrollHeight;
    await nextFrame(view);
    await nextFrame(view);
    if (settleMs > 0) await new Promise((resolve) => view.setTimeout(resolve, settleMs));
    if (scroller.scrollHeight === height) return;
  }
}

/**
 * How long to wait for an animation frame before going on without one.
 * Chrome runs no animation frames in a hidden tab (the extension keeps the
 * WhatsApp tab "visible" while it records, but if that fails, waits must
 * still end); timers there run about once a second.
 */
const frameFallbackMs = 100;

/** Resolves at the next animation frame, or after `frameFallbackMs` if none comes. */
function nextFrame(view: Window): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      view.cancelAnimationFrame(frame);
      view.clearTimeout(timer);
      resolve();
    };
    const frame = view.requestAnimationFrame(done);
    const timer = view.setTimeout(done, frameFallbackMs);
  });
}

/**
 * The element that scrolls the message list. WhatsApp Web gives it only a
 * generated class name, so it is found as the tallest scrolling element in
 * the conversation pane (the message box can scroll too, but is short).
 */
function messageScroller(doc: Document): HTMLElement {
  const pane = find(doc, selectors.conversationPane, 'the conversation pane');
  const view = doc.defaultView!;
  let tallest: HTMLElement | undefined;
  for (const element of pane.querySelectorAll<HTMLElement>('*')) {
    const { overflowY } = view.getComputedStyle(element);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    if (!tallest || element.clientHeight > tallest.clientHeight) tallest = element;
  }
  if (!tallest) throw new PageNotRecognisedError('the scrolling container of the message list is missing');
  return tallest;
}

/**
 * The message list: the scroller's child that holds the items (the one with
 * messages in it, or else the tallest).
 */
function messageList(doc: Document): Element {
  const children = Array.from(messageScroller(doc).children);
  const list =
    children.find((child) => child.querySelector(selectors.message)) ??
    children.reduce<Element | undefined>((a, b) => (!a || b.scrollHeight > a.scrollHeight ? b : a), undefined);
  if (!list) throw new PageNotRecognisedError('the message list is missing');
  return list;
}

function clipToViewport(area: Rect, doc: Document): Rect {
  const viewportWidth = doc.documentElement.clientWidth;
  const viewportHeight = doc.documentElement.clientHeight;
  const left = Math.max(area.left, 0);
  const top = Math.max(area.top, 0);
  const right = Math.min(area.left + area.width, viewportWidth);
  const bottom = Math.min(area.top + area.height, viewportHeight);
  return { left, top, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
}

function find(doc: Document, selector: string, what: string): Element {
  const element = doc.querySelector(selector);
  if (!element) throw new PageNotRecognisedError(`${what} (${selector}) is missing`);
  return element;
}
