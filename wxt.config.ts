import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'WhatsApp Assistant',
    description: 'Makes Chat Records: faithful images of a WhatsApp Web Chat.',
    host_permissions: ['https://web.whatsapp.com/*'],
    permissions: [],
  },
});
