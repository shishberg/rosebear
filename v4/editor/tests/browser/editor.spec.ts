import { test, expect, type Page } from '@playwright/test';
const rebuilt = (page: Page) =>
  expect(page.locator('#view-state')).toContainText('Chassis rebuilt', { timeout: 30000 });
const project = (page: Page) => page.evaluate(() => (window as any).rosebearEditor.getProject());
async function dragHandle(page: Page, id: string, dx: number, dy: number) {
  const h = await page.evaluate((id) => (window as any).rosebearEditor.handleScreen(id), id);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + dx, h.y + dy, { steps: 4 });
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await rebuilt(page);
});

test('key handles set height and stagger, with undo, persistence and file roundtrip', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('#fit-badge')).toHaveText('Clearance checks PASS');
  await expect(page.locator('#fit-list')).toContainText('one piece');
  const before = (await project(page)).config.geometry.columns[2];
  // Front view: dragging up raises the key. Sideways movement is ignored.
  await page.locator('[data-view="Front"]').click();
  await dragHandle(page, 'key:matrix_middle_top', 15, -30);
  await expect(page.locator('#view-state')).toContainText('showing the previous chassis');
  await expect(page.locator('#stl')).toBeDisabled();
  await rebuilt(page);
  let col = (await project(page)).config.geometry.columns[2];
  expect(col.heights_mm[0]).toBeGreaterThan(before.heights_mm[0] + 5);
  expect(col.heights_mm[1]).toBe(before.heights_mm[1]);
  expect(col.offset_mm[0]).toBe(before.offset_mm[0]);
  await expect(page.locator('#selection')).toContainText('middle column');
  // Side view: dragging along the column changes its stagger.
  await page.locator('[data-view="Inner"]').click();
  await dragHandle(page, 'key:matrix_middle_home', -25, 0);
  await rebuilt(page);
  col = (await project(page)).config.geometry.columns[2];
  expect(Math.abs(col.offset_mm[1] - before.offset_mm[1])).toBeGreaterThan(3);
  await page.locator('#undo').click();
  await page.locator('#undo').click();
  expect((await project(page)).config.geometry.columns[2]).toEqual(before);
  await page.locator('#redo').click();
  await page.locator('#redo').click();
  expect((await project(page)).config.geometry.columns[2]).toEqual(col);
  await page.reload();
  await rebuilt(page);
  expect((await project(page)).config.geometry.columns[2]).toEqual(col);
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('rosebear-chassis-project.json');
  await page.locator('#reset').click();
  await page.locator('#file').setInputFiles((await file.path())!);
  await expect(page.locator('#load-error')).toHaveText('');
  await expect
    .poll(async () => (await project(page)).config.geometry.columns[2].heights_mm[0])
    .toBeGreaterThan(before.heights_mm[0] + 5);
  await rebuilt(page);
  await page.locator('#caps').check();
  await page.locator('[data-view="3D"]').click();
  await page.screenshot({ path: 'test-results/editor.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('thumb clusters move and turn, and fields edit the same values', async ({ page }) => {
  const before = (await project(page)).config.geometry.thumb;
  await page.locator('[data-view="Top"]').click();
  await dragHandle(page, 'cluster:thumb', -12, 0);
  await rebuilt(page);
  let th = (await project(page)).config.geometry.thumb;
  expect(th.position_mm[0]).toBeLessThan(before.position_mm[0] - 2);
  expect(th.rotation_deg).toEqual(before.rotation_deg);
  expect(th.position_mm[2]).toBe(before.position_mm[2]);
  await expect(page.locator('#selection')).toContainText('thumb cluster');
  await dragHandle(page, 'turn:thumb', 25, 0);
  await rebuilt(page);
  th = (await project(page)).config.geometry.thumb;
  expect(Math.abs(th.rotation_deg[2] - before.rotation_deg[2])).toBeGreaterThan(5);
  const well = page.locator('#selection label').filter({ hasText: 'Well' }).locator('input');
  await well.fill('20');
  await well.press('Tab');
  expect((await project(page)).config.geometry.thumb.arc.well_deg).toBe(20);
  await rebuilt(page);
  await page.screenshot({ path: 'test-results/thumbs.png', fullPage: true });
});
test('a newer edit supersedes an in-flight build; invalid imports leave the project intact', async ({
  page,
}) => {
  await page.locator('[data-view="Front"]').click();
  await dragHandle(page, 'key:matrix_ring_home', 0, -5);
  const field = page
      .locator('#selection label')
      .filter({ hasText: 'home key height' })
      .locator('input'),
    z = Number(await field.inputValue());
  await field.fill(String(z + 0.5));
  await field.press('Tab');
  await page.locator('#rebuild').click();
  await field.fill(String(z + 1));
  await field.press('Tab');
  await field.fill(String(z + 1.5));
  await field.press('Tab');
  await expect(page.locator('#stl')).toBeDisabled();
  await rebuilt(page);
  expect(
    await page.evaluate(() => {
      const e = (window as any).rosebearEditor;
      return e.getRevision() === e.getSolidRevision();
    }),
  ).toBe(true);
  const reportDownload = page.waitForEvent('download');
  await page.locator('#report').click();
  const file = await reportDownload;
  const fs = await import('node:fs/promises'),
    saved = JSON.parse(await fs.readFile((await file.path())!, 'utf8'));
  expect(saved.evaluatedProject.config.geometry.columns[3].heights_mm[1]).toBeCloseTo(z + 1.5, 2);
  const stl = page.waitForEvent('download');
  await page.locator('#stl').click();
  const solid = await stl;
  const bytes = await fs.readFile((await solid.path())!);
  expect(bytes.length).toBe(84 + 50 * bytes.readUInt32LE(80));
  const initial = await project(page);
  await page
    .locator('#file')
    .setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"version":999}'),
    });
  await expect(page.locator('#load-error')).toContainText('Not a Rosebear editor project');
  expect(await project(page)).toEqual(initial);
});
test('clearance overlays isolate collisions, toggle, and clear on edit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A keycap bottom 2 mm below the seat plane at full press makes every keycap hit its plate.
  const bottom = page.locator('#bottom-out'),
    cfg = JSON.parse(await page.locator('#config').inputValue());
  cfg.switch.keycap_bottom_above_plate_mm = cfg.switch.travel_mm - 2;
  await page.locator('details summary').click();
  await page.locator('#config').fill(JSON.stringify(cfg));
  await page.locator('#apply-config').click();
  await rebuilt(page);
  await expect(page.locator('#fit-badge')).toHaveText('Clearance checks FAIL');
  const highlights = () => page.evaluate(() => (window as any).rosebearEditor.getHighlights());
  const all = await highlights();
  expect(all.length).toBeGreaterThan(1);
  expect(all.every((h: any) => h.visible && h.triangles > 0)).toBe(true);
  await page.locator('#fit-list button').filter({ hasText: 'thumb home' }).click();
  const visible = (await highlights()).filter((h: any) => h.visible);
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.every((h: any) => h.name === 'thumb_home')).toBe(true);
  await page.locator('#show-failures').uncheck();
  expect((await highlights()).every((h: any) => !h.visible)).toBe(true);
  await page.locator('#all-failures').click();
  expect((await highlights()).every((h: any) => h.visible)).toBe(true);
  await bottom.fill('2');
  await bottom.press('Tab');
  expect(await highlights()).toEqual([]);
  await rebuilt(page);
  await expect(page.locator('#fit-badge')).toHaveText('Clearance checks PASS');
  expect(errors).toEqual([]);
});
