import { serveCaptureSessions } from '../extension/capture-sessions';
import type { OpenPanelRequest } from '../extension/messages';
import { serveSelfReload } from '../extension/self-reload';
import { serveTranslation } from '../extension/translation-service';

/**
 * The background worker captures the tab for Chat Records (through Chrome's
 * debugger, see docs/adr/0004); it never stores or sends what it captures.
 * It also runs auto-translation's Telegram bot (see docs/adr/0005), which
 * sends the Translated Chat's new messages, and only those, to Telegram.
 */
export default defineBackground(() => {
  // Let the content script keep pending Continuations (ids and dates only) in
  // session storage, which by default only the extension's own pages can use.
  const shareSessionStorage = () =>
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
  void shareSessionStorage();
  chrome.runtime.onStartup.addListener(shareSessionStorage);
  chrome.runtime.onInstalled.addListener(shareSessionStorage);

  const captureSessions = serveCaptureSessions();
  serveTranslation();
  // New builds load on their own (unpacked only); never during a Chat Record.
  serveSelfReload({ busy: captureSessions.busy });

  // Clicking the toolbar icon opens the panel (a shortcut; the header button does too).
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    const request: OpenPanelRequest = { type: 'open-panel' };
    chrome.tabs.sendMessage(tab.id, request).catch(() => {
      // Not a WhatsApp Web tab, or the content script is not there yet.
    });
  });
});
