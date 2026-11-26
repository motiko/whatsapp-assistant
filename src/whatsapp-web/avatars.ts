import { selectors } from './selectors';

const styleId = 'whatsapp-assistant-hide-avatars';

/**
 * Shows or hides every avatar on WhatsApp Web, including ones it adds later.
 * Hidden avatars keep their space, so nothing else on the page moves.
 */
export function setAvatarsHidden(doc: Document, hidden: boolean): void {
  const existing = doc.getElementById(styleId);
  if (!hidden) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = doc.createElement('style');
  style.id = styleId;
  style.textContent = `${selectors.avatar} { visibility: hidden !important; }`;
  (doc.head ?? doc.documentElement).append(style);
}
