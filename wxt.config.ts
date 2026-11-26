import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'wxt';

/**
 * Unique per build. Baked into the code as __BUILD_ID__ and written to
 * `build-id.txt` next to the manifest: the running (unpacked) extension
 * compares the two and reloads itself, and WhatsApp Web, when a newer build
 * lands in its folder (see src/extension/self-reload.ts).
 */
const buildId = String(Date.now());

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'WhatsApp Assistant',
    description: 'Makes Chat Records of WhatsApp Web Chats, and translates one Chat through a Telegram bot.',
    // api.telegram.org: the auto-translation bot. translate.googleapis.com:
    // the default (free) translator. See docs/adr/0005.
    host_permissions: ['https://web.whatsapp.com/*', 'https://api.telegram.org/*', 'https://translate.googleapis.com/*'],
    // The LLM translator's API, whatever host the user configures; asked for
    // on the options page, for that one origin only.
    optional_host_permissions: ['https://*/*'],
    // debugger: captures the WhatsApp tab with Page.captureScreenshot, also
    // while it is in the background, and keeps it rendering meanwhile; attached
    // only for the length of one Chat Record (see docs/adr/0004).
    // clipboardWrite: writing the PNG to the clipboard.
    // storage: chrome.storage.session, for pending Continuations (ids and
    // dates only; in memory, cleared when Chrome closes); chrome.storage.local
    // for the translation settings and bot state, and the WhatsApp Web settings
    // (Hide avatars, src/extension/settings.ts).
    // No `downloads`: Download clicks a download link in the content script,
    // which needs no permission (see src/extension/download.ts).
    // alarms: restarts the Telegram bot's polling after Chrome stops the worker.
    permissions: ['debugger', 'clipboardWrite', 'storage', 'alarms'],
    action: { default_title: 'WhatsApp Assistant: Chat Record' },
  },
  vite: () => ({
    define: { __BUILD_ID__: JSON.stringify(buildId) },
  }),
  hooks: {
    'build:done': async (wxt) => {
      await writeFile(join(wxt.config.outDir, 'build-id.txt'), buildId);
    },
  },
});
