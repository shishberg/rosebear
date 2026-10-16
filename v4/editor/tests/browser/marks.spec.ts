// The marks tool is in dev builds only, so this runs against Vite's dev server
// (playwright.hand.config.ts).
import { test, expect, type Page } from '@playwright/test';

// Two saved marks, a stroke each, served in place of marks/.
const mark = (id: string, x: number) => ({
  id,
  time: '2026-10-17T00:00:00Z',
  commit: 'test',
  note: 'note ' + id,
  camera: { position: [0, -300, 200], target: [0, 0, 0], up: [0, 0, 1], fov: 40 },
  strokes: [
    {
      screen: [
        [0.4, 0.5],
        [0.6, 0.5],
      ],
      hits: [
        { p: [x, 0, 0], n: [0, 0, 1], on: 'shell' },
        { p: [x + 20, 0, 0], n: [0, 0, 1], on: 'shell' },
      ],
    },
  ],
});
// Each mark's stroke colours, as 'mark colour'.
const colours = (page: Page) =>
  page.evaluate(() =>
    [
      ...new Set(
        (window as any).rosebearEditor
          .getMarks()
          .map((s: any) => s.mark + ' ' + s.color.toString(16)),
      ),
    ].sort(),
  );
const YELLOW = 'rgb(255, 210, 26)',
  GREEN = 'rgb(57, 255, 60)';

test('clicking a saved mark picks out its strokes in green', async ({ page }) => {
  await page.route('**/__marks', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: [mark('a', -40), mark('b', 40)] })
      : r.continue(),
  );
  await page.goto('/');
  const link = (id: string) => page.locator(`#mk-list a[data-go="${id}"]`);
  await expect(link('b')).toBeVisible();
  await expect.poll(() => colours(page)).toEqual(['a ffd21a', 'b ffd21a']);
  // Picked: green on the model and in the list; the other stays yellow.
  await link('a').click();
  await expect.poll(() => colours(page)).toEqual(['a 39ff3c', 'b ffd21a']);
  await expect(link('a')).toHaveCSS('color', GREEN);
  await expect(link('b')).toHaveCSS('color', YELLOW);
  // Another moves it.
  await link('b').click();
  await expect.poll(() => colours(page)).toEqual(['a ffd21a', 'b 39ff3c']);
  await expect(link('a')).toHaveCSS('color', YELLOW);
  // The same one again drops it.
  await link('b').click();
  await expect.poll(() => colours(page)).toEqual(['a ffd21a', 'b ffd21a']);
  await expect(link('b')).toHaveCSS('color', YELLOW);
  // ?mark= opens on a mark picked.
  await page.goto('/?mark=b');
  await expect.poll(() => colours(page)).toEqual(['a ffd21a', 'b 39ff3c']);
});
