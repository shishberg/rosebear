// PROTOTYPE ?hand: the case is not built unless asked, so nothing of it may show.
import { test, expect } from '@playwright/test';
import { rebuilt } from './helpers';

test('?hand shows no shell, trim or bottom section until the case is built', async ({ page }) => {
  await page.goto('/?hand');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#view-state')).toContainText(/mm tall/, {
    timeout: 30000,
  });
  // The View box asks for the bottom section; only the hand's build-case gate hides it.
  await expect(page.locator('#base')).toBeChecked();
  const visible = () => page.evaluate(() => (window as any).rosebearEditor.getVisible());
  expect(await visible()).toEqual({ shell: false, base: false, trim: false });
  // Control: with the case on, the same box shows it.
  await page.getByLabel('Build the case (often fails)').check();
  await rebuilt(page);
  expect((await visible()).base).toBe(true);
});
