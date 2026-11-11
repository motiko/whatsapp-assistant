import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'WhatsApp Assistant',
    description: 'Makes Chat Records: faithful images of a WhatsApp Web Chat.',
    host_permissions: ['https://web.whatsapp.com/*'],
    // debugger: captures the WhatsApp tab with Page.captureScreenshot, also
    // while it is in the background, and keeps it rendering meanwhile; attached
    // only for the length of one Chat Record (see docs/adr/0004).
    // clipboardWrite: writing the PNG to the clipboard.
    // storage: chrome.storage.session, for pending Continuations (ids and
    // dates only; in memory, cleared when Chrome closes).
    // No `downloads`: Download clicks a download link in the content script,
    // which needs no permission (see src/extension/download.ts).
    permissions: ['debugger', 'clipboardWrite', 'storage'],
    action: { default_title: 'WhatsApp Assistant: Chat Record' },
  },
});
