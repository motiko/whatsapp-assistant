import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      // Real Chrome shows scrollbars; headless Playwright hides them by default.
      provider: playwright({
        launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
        // A fixed timezone, so local days and times in tests are the same on every machine.
        contextOptions: { timezoneId: 'Europe/Berlin' },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1280, height: 800 },
    },
  },
});
