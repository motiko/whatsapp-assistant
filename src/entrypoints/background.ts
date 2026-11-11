import {
  isCaptureVisibleTabRequest,
  type CaptureVisibleTabResponse,
  type OpenPanelRequest,
} from '../extension/messages';

/**
 * The background worker does the one thing a content script cannot:
 * capture the visible tab. It never stores or sends what it captures.
 */
export default defineBackground(() => {
  // Let the content script keep pending Continuations (ids and dates only) in
  // session storage, which by default only the extension's own pages can use.
  const shareSessionStorage = () =>
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
  void shareSessionStorage();
  chrome.runtime.onStartup.addListener(shareSessionStorage);
  chrome.runtime.onInstalled.addListener(shareSessionStorage);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isCaptureVisibleTabRequest(message)) return false;
    captureSenderTab(sender).then(sendResponse);
    return true; // responds asynchronously
  });

  // Clicking the toolbar icon grants `activeTab` for this tab (which capture
  // needs) and opens the panel.
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    const request: OpenPanelRequest = { type: 'open-panel' };
    chrome.tabs.sendMessage(tab.id, request).catch(() => {
      // Not a WhatsApp Web tab, or the content script is not there yet.
    });
  });
});

async function captureSenderTab(sender: chrome.runtime.MessageSender): Promise<CaptureVisibleTabResponse> {
  const tab = sender.tab;
  if (tab?.id === undefined) return { ok: false, notAllowed: false, error: 'No tab to capture.' };
  try {
    // captureVisibleTab captures whichever tab is active in the window, so
    // refuse unless that is still the WhatsApp tab that asked.
    const current = await chrome.tabs.get(tab.id);
    if (!current.active) {
      return { ok: false, notAllowed: false, error: 'The WhatsApp tab is not the visible tab.' };
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(current.windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notAllowed = /activeTab|<all_urls>|permission/i.test(message);
    return { ok: false, notAllowed, error: message };
  }
}
