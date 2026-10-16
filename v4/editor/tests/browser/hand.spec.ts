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
  await expect(note).toContainText(
    /middle while the index (reaches for|is on) inner top: into index home/,
  );
  // The wrist height sets the reach between rows, and says when no reach gives it.
  const wrist = page.locator('label', { hasText: 'wrist height (mm' });
  await expect(note).toContainText(/Between rows the MCP bends 0\.40° per PIP degree/);
  await wrist.locator('input').focus();
  await page.keyboard.press('End');
  await expect(wrist.locator('output')).toHaveText('130');
  await expect(note).toContainText(/wrist \d+ mm too high for this curl/);
  await page.keyboard.press('ArrowLeft');
  await expect(wrist.locator('output')).toHaveText('129.5');
  // The thumb shown pressing its key, over and over.
  await page.getByText('Show the thumb pressing it').click();
  await page.waitForTimeout(500);
  // How far the thumb rolls onto its outer edge for each key.
  await expect(note).toContainText(
    /Thumb rolled onto its outer edge: far \d+°, home \d+°, near \d+°/,
  );
  // The frame shown is the one checked.
  await page.getByText('Test frame (print this way up, with supports)').click();
  await expect(page.getByText(/cm³/)).toBeVisible();
  // It stays shown after a reload.
  await page.reload();
  await expect(page.getByLabel('Test frame (print this way up, with supports)')).toBeChecked();
  await expect(page.getByText(/cm³/)).toBeVisible({ timeout: 30000 });
  expect(errors).toEqual([]);
});
