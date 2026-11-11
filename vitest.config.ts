import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      // Real Chrome shows scrollbars; headless Playwright hides them by default.
      provider: playwright({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1280, height: 800 },
    },
  },
});
