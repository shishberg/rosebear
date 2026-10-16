// PROTOTYPE ?hand and the marks tool are in dev builds only, so their browser
// tests run against Vite's dev server.
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['hand*.spec.ts', 'marks.spec.ts'],
  testIgnore: [],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5179' },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
