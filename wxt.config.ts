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
    permissions: ['activeTab', 'clipboardWrite'],
    action: { default_title: 'WhatsApp Assistant: Chat Record' },
  },
});
