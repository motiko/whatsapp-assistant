import { serveCaptureSessions } from '../extension/capture-sessions';
import type { OpenPanelRequest } from '../extension/messages';

/**
 * The background worker does the one thing a content script cannot:
 * capture the tab (through Chrome's debugger, see docs/adr/0004). It never
 * stores or sends what it captures.
 */
export default defineBackground(() => {
  // Let the content script keep pending Continuations (ids and dates only) in
  // session storage, which by default only the extension's own pages can use.
  const shareSessionStorage = () =>
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
  void shareSessionStorage();
  chrome.runtime.onStartup.addListener(shareSessionStorage);
  chrome.runtime.onInstalled.addListener(shareSessionStorage);

  serveCaptureSessions();

  // Clicking the toolbar icon opens the panel (a shortcut; the header button does too).
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    const request: OpenPanelRequest = { type: 'open-panel' };
    chrome.tabs.sendMessage(tab.id, request).catch(() => {
      // Not a WhatsApp Web tab, or the content script is not there yet.
    });
  });
});
