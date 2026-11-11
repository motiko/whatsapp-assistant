import { PageNotRecognisedError, type Rect, type WhatsAppPage } from '../core/whatsapp-page';
import { selectors } from './selectors';

/**
 * The real WhatsApp Page: reads the Chat open in WhatsApp Web's page.
 * The only module (with `selectors.ts` and `chat-header.ts`) that knows
 * WhatsApp Web's page structure.
 */
export function createWhatsAppWebPage(doc: Document): WhatsAppPage {
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
  };
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
