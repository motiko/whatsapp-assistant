import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'WhatsApp Assistant',
    description: 'Makes Chat Records: faithful images of a WhatsApp Web Chat.',
    host_permissions: ['https://web.whatsapp.com/*'],
    // activeTab: Chrome only lets captureVisibleTab run with activeTab or
    // <all_urls>; activeTab keeps access to the tab the user picked.
    // clipboardWrite: writing the PNG to the clipboard.
    // storage: chrome.storage.session, for pending Continuations (ids and
    // dates only; in memory, cleared when Chrome closes).
    // No `downloads`: Download clicks a download link in the content script,
    // which needs no permission (see src/extension/download.ts).
    permissions: ['activeTab', 'clipboardWrite', 'storage'],
    action: { default_title: 'WhatsApp Assistant: Chat Record' },
  },
});
