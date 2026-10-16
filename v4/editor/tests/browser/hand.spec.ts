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
  // One state, in the project: saved and opened with it (what's shown too),
  // the keys always laid out from it, every change to it one Undo step.
  const project = () =>
    page.evaluate(() =>
      JSON.stringify(
        (
          window as unknown as { rosebearEditor: { getProject(): unknown } }
        ).rosebearEditor.getProject(),
      ),
    );
  const bottom = page.getByRole('radio', { name: 'bottom', exact: true });
  await bottom.check();
  const saved = await project(),
    download = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await download;
  await page.getByRole('button', { name: 'Natural' }).click();
  await page.getByRole('radio', { name: 'top', exact: true }).check();
  await expect(wrist.locator('output')).toHaveText('112.7');
  await page.locator('#file').setInputFiles((await file.path())!);
  await expect(page.locator('#load-error')).toHaveText('');
  await expect(wrist.locator('output')).toHaveText('129.5');
  await expect(bottom).toBeChecked();
  await expect(note).toContainText(/wrist \d+ mm too high for this curl/);
  expect(await project()).toEqual(saved);
  // A setting moved and back: the same keys.
  const reach = page
    .locator('label', { hasText: 'thumb reach: palmar abduction' })
    .locator('input');
  await reach.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(project).not.toEqual(saved);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(project).toEqual(saved);
  // Undo: back through those two, then to before the file was opened.
  for (let i = 0; i < 2; i++) await page.locator('#undo').click();
  expect(await project()).toEqual(saved);
  await page.locator('#undo').click();
  await expect(wrist.locator('output')).toHaveText('112.7');
  await expect(page.getByRole('radio', { name: 'top', exact: true })).toBeChecked();
  await page.locator('#redo').click();
  await expect(wrist.locator('output')).toHaveText('129.5');
  await expect(bottom).toBeChecked();
  // A file whose keys aren't its settings' opens with the settings' keys.
  const fs = await import('node:fs/promises'),
    moved = JSON.parse(await fs.readFile((await file.path())!, 'utf8'));
  moved.config.geometry.thumb.position_mm[0] += 15;
  await fs.writeFile('test-results/moved-keys.json', JSON.stringify(moved));
  await page.getByRole('button', { name: 'Natural' }).click();
  await page.locator('#file').setInputFiles('test-results/moved-keys.json');
  await expect(wrist.locator('output')).toHaveText('129.5');
  expect(await project()).toEqual(saved);
  // The thumb shown pressing its key, over and over.
  await page.getByText('Show the thumb pressing it').click();
  await page.waitForTimeout(500);
  // With the thumb at rest it stops.
  await page.evaluate(() => {
    const w = window as unknown as { frames: number };
    w.frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => ((w.frames += 1), raf(f));
  });
  await page.getByRole('radio', { name: 'rest', exact: true }).check();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => (window as unknown as { frames: number }).frames);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { frames: number }).frames)).toBe(before);
  await page.getByRole('radio', { name: 'home', exact: true }).first().check();
  // Each thumb key's place round the arc, how the thumb bends and rolls there.
  await expect(note).toContainText(
    /Thumb keys round the arc: far \d+°, home 112°, near \d+°.*Bent at the MCP \/ IP: .*On its side by -?\d+°, -?\d+°, -?\d+°/,
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

test('the column and cluster handles and fields are off in ?hand', async ({ page }) => {
  await page.goto('/?hand');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#hand-note')).toContainText('Valid (', { timeout: 30000 });
  const h = await page.evaluate(() =>
    (window as any).rosebearEditor.handleScreen('key:matrix_middle_top'),
  );
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 10, h.y - 30, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).rosebearEditor.getSelected())).toBe('');
  await expect(page.locator('#selection')).toBeEmpty();
});
