import { selectors } from './selectors';

/**
 * Keeps `element` in the open Chat's header, just before WhatsApp's own
 * header icons. WhatsApp Web replaces the header whenever the user opens
 * another Chat, so the element is moved into each new header as it appears.
 * Returns a function that stops following the header.
 */
export function keepInChatHeader(doc: Document, element: HTMLElement): () => void {
  const place = () => {
    const header = doc.querySelector(selectors.chatHeader);
    if (!header || header.contains(element)) return;
    header.insertBefore(element, header.lastElementChild);
  };
  const observer = new MutationObserver(place);
  observer.observe(doc.body, { childList: true, subtree: true });
  place();
  return () => observer.disconnect();
}
