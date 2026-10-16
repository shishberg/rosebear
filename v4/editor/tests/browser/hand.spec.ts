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
  await expect(note).toContainText(/Between rows the MCP bends -0\.10° per PIP degree/);
  // Natural, valid too.
  await page.getByRole('button', { name: 'Natural' }).click();
  await expect(note).toContainText(/Between rows the MCP bends 0\.40° per PIP degree/);
  await expect(note).toContainText('Valid (', { timeout: 30000 });
  // The wrist height sets the reach between rows, and says when no reach gives it.
  const wrist = page.locator('label', { hasText: 'wrist height (mm' });
  await wrist.locator('input').focus();
  await page.keyboard.press('End');
  await expect(wrist.locator('output')).toHaveText('130');
  await expect(note).toContainText(/wrist \d+ mm too high for this curl/);
  await page.keyboard.press('ArrowLeft');
  await expect(wrist.locator('output')).toHaveText('129.5');
  // The thumb shown pressing its key, over and over.
  await page.getByText('Show the thumb pressing it').click();
  await page.waitForTimeout(500);
  // Each thumb key's place round the arc, how the thumb bends and rolls there.
  await expect(note).toContainText(
    /Thumb keys round the arc: far \d+°, home 112°, near \d+°.*Bent at the MCP \/ IP: .*Rolled onto its outer edge: \d+°, \d+°, \d+°/,
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
