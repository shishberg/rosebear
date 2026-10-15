// PROTOTYPE ?hand: the readout checks the hand against the keycaps and the test frame.
import { test, expect } from '@playwright/test';

test('the hand readout checks every reach against the keycaps and the frame', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?hand');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const note = page.locator('#hand-note');
  // The Dactyl fit, once the frame is built and checked too.
  await expect(note).toContainText('Valid (', { timeout: 30000 });
  await page.getByRole('button', { name: 'Natural' }).click();
  await expect(note).toContainText('middle while the index reaches for inner top: into index home');
  // The frame shown is the one checked.
  await page.getByText('Test frame (print this way up, with supports)').click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  expect(errors).toEqual([]);
});
