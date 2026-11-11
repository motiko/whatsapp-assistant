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
      const scroller = messageScroller(doc);
      const list = find(doc, selectors.messageList, 'the message list');
      // Content position 0 is the top of the scroll container's content.
      const origin = scroller.getBoundingClientRect().top + scroller.clientTop - scroller.scrollTop;
      const now = today();
      const items: ChatItem[] = [];
      for (const row of list.querySelectorAll(selectors.messageListRow)) {
        const box = row.getBoundingClientRect();
        const span = { top: box.top - origin, bottom: box.bottom - origin };
        if (row.querySelector(selectors.message)) {
          items.push({ kind: 'message', ...span });
          continue;
        }
        const day = readDividerDay(row.textContent?.trim() ?? '', now, locale);
        if (day) items.push({ kind: 'date-divider', day, ...span });
      }
      return items;
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
 * The oldest message loaded (its `data-id`, which names it). WhatsApp Web may
 * unload newer messages as it loads older ones, so a new oldest message, not
 * the list's height, tells that older ones arrived.
 */
function oldestMessage(doc: Document): string | undefined {
  const list = find(doc, selectors.messageList, 'the message list');
  return list.querySelector(selectors.message)?.getAttribute('data-id') ?? undefined;
}

/** Polls `condition` each frame for up to `waitMs`; resolves whether it became true. */
async function waitFor(view: Window, condition: () => boolean, waitMs: number): Promise<boolean> {
  const deadline = view.performance.now() + waitMs;
  for (;;) {
    await new Promise((resolve) => view.requestAnimationFrame(() => view.setTimeout(resolve, 10)));
    if (condition()) return true;
    if (view.performance.now() >= deadline) return false;
  }
}

/** WhatsApp Web's "get older messages from your phone" prompt, if it shows one. */
function olderMessagesPrompt(doc: Document): HTMLElement | undefined {
  const list = find(doc, selectors.messageList, 'the message list');
  for (const row of list.querySelectorAll(selectors.messageListRow)) {
    if (row.querySelector(selectors.message)) continue;
    for (const button of row.querySelectorAll<HTMLElement>(selectors.rowButton)) {
      if (olderMessagesPromptText.test(button.textContent ?? '')) return button;
    }
  }
  return undefined;
}

/** Resolves once the list has been painted and its height has stopped changing. */
async function settle(view: Window, scroller: HTMLElement, settleMs: number): Promise<void> {
  for (let round = 0; round < 20; round++) {
    const height = scroller.scrollHeight;
    await new Promise((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(resolve)));
    if (settleMs > 0) await new Promise((resolve) => view.setTimeout(resolve, settleMs));
    if (scroller.scrollHeight === height) return;
  }
}

/**
 * The element that scrolls the message list. WhatsApp Web gives it only a
 * generated class name, so it is found as the message list's nearest
 * scrolling ancestor inside the conversation pane.
 */
function messageScroller(doc: Document): HTMLElement {
  const pane = find(doc, selectors.conversationPane, 'the conversation pane');
  const list = find(doc, selectors.messageList, 'the message list');
  const view = doc.defaultView!;
  for (let element = list.parentElement; element && element !== pane; element = element.parentElement) {
    const { overflowY } = view.getComputedStyle(element);
    if (overflowY === 'auto' || overflowY === 'scroll') return element;
  }
  throw new PageNotRecognisedError('the scrolling container of the message list is missing');
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
