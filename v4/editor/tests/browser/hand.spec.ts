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
  // The reach mix goes down to -0.4 in hundredths.
  await page.getByText('Advanced settings').click();
  const mix = page.locator('label', { hasText: 'reach mix: MCP° per PIP°' });
  const range = mix.locator('input');
  await range.focus();
  await page.keyboard.press('Home');
  await expect(mix.locator('output')).toHaveText('-0.4');
  await page.keyboard.press('ArrowRight');
  await expect(mix.locator('output')).toHaveText('-0.39');
  await page.keyboard.press('End');
  await expect(mix.locator('output')).toHaveText('3');
  // The frame shown is the one checked.
  await page.getByText('Test frame (print this way up, with supports)').click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  // It stays shown after a reload.
  await page.reload();
  await expect(page.getByLabel('Test frame (print this way up, with supports)')).toBeChecked();
  await expect(page.getByText(/cm³/)).toBeVisible({ timeout: 30000 });
  expect(errors).toEqual([]);
});
