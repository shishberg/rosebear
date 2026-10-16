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
  const baseStl = page.waitForEvent('download');
  await page.locator('#stl-base').click();
  const baseBytes = await fs.readFile((await (await baseStl).path())!);
  expect(baseBytes.readUInt32LE(80)).toBeGreaterThan(100);
  expect(baseBytes.length).toBe(84 + 50 * baseBytes.readUInt32LE(80));
  const initial = await project(page);
  await page.locator('#file').setInputFiles({
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
  await page.getByText('All configuration').click();
  await page.locator('#config').fill(JSON.stringify(cfg));
  await page.locator('#apply-config').click();
  await rebuilt(page);
  await expect(page.locator('#fit-badge')).toHaveText('Clearance checks FAIL');
  const highlights = () => page.evaluate(() => (window as any).rosebearEditor.getHighlights());
  const all = await highlights();
  expect(all.length).toBeGreaterThan(1);
  expect(all.every((h: any) => h.visible && h.triangles > 0)).toBe(true);
  await page
    .locator('#fit-list button')
    .filter({ hasText: /^thumb home: .* at rest/ })
    .click();
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
test('the wiring panel lists the matrix and cut list, and the wiring follows the keys', async ({
  page,
}) => {
  await expect(page.locator('#wiring-summary')).toContainText('100 wires, 200 solder joints');
  await expect(page.locator('#matrix-table tr')).toHaveCount(21);
  await expect(page.locator('#fit-list')).toContainText('All 100 wires are clear of the chassis.');
  const wiring = () => page.evaluate(() => (window as any).rosebearEditor.getWiring());
  const before = (await wiring()).pads.find((p: any) => p.key === 'matrix_middle_top').at;
  await page.locator('[data-view="Front"]').click();
  await dragHandle(page, 'key:matrix_middle_top', 0, -30);
  // The worker routes the wires with the chassis, so they follow on the rebuild.
  await rebuilt(page);
  const after = (await wiring()).pads.find((p: any) => p.key === 'matrix_middle_top').at;
  expect(after[2]).toBeGreaterThan(before[2] + 3);
  await page.locator('#wires').uncheck();
  await page.locator('#wires').check();
  // The adapter and ribbons hide on their own, leaving the wiring and pads.
  const shown = (group: string) =>
    page.evaluate(
      (group) =>
        (window as any).rosebearEditor
          .getHardware()
          .filter((p: any) => p.group === group)
          .every((p: any) => p.visible),
      group,
    );
  await page.locator('#adapter').uncheck();
  expect(await shown('adapter')).toBe(false);
  expect(await shown('ribbon')).toBe(false);
  expect(await shown('pads')).toBe(true);
  await page.locator('#adapter').check();
  expect(await shown('adapter')).toBe(true);
  await rebuilt(page);
});

test('the bottom section checkbox survives a rebuild', async ({ page }) => {
  const base = () => page.evaluate(() => (window as any).rosebearEditor.getVisible().base);
  expect(await base()).toBe(true);
  await page.locator('#base').uncheck();
  expect(await base()).toBe(false);
  await page.locator('#rebuild').click();
  await rebuilt(page);
  expect(await base()).toBe(false);
});
test('a selected cluster or column that disappears clears the selection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const selected = () => page.evaluate(() => (window as any).rosebearEditor.getSelected());
  const config = page.locator('#config');
  await page.getByText('All configuration').click();
  await page.locator('[data-view="Top"]').click();
  await dragHandle(page, 'cluster:thumb_extra', 0, 0);
  expect(await selected()).toBe('cluster:thumb_extra');
  await expect(page.locator('#selection')).toContainText('extra thumb row');
  const cfg = JSON.parse(await config.inputValue());
  delete cfg.geometry.thumb_extra;
  await config.fill(JSON.stringify(cfg));
  await page.locator('#apply-config').click();
  await expect(page.locator('#load-error')).toHaveText('');
  expect(await selected()).toBe('');
  await expect(page.locator('#selection')).toBeEmpty();
  expect((await project(page)).config.geometry.thumb_extra).toBeUndefined();
  await rebuilt(page);
  // Undo brings the cluster back, unselected.
  await page.locator('#undo').click();
  expect(await selected()).toBe('');
  expect((await project(page)).config.geometry.thumb_extra).toBeDefined();
  expect(errors).toEqual([]);
});
test('column fields follow the column by name in the project', async ({ page }) => {
  const cfg = (await project(page)).config,
    cols = cfg.geometry.columns,
    i = cols.findIndex((c: any) => c.name === 'ring'),
    j = cols.findIndex((c: any) => c.name === 'pinky');
  cols[i].offset_mm[0] = 2;
  cols[j].offset_mm[0] = 5;
  [cols[i], cols[j]] = [cols[j], cols[i]];
  await page.getByText('All configuration').click();
  await page.locator('#config').fill(JSON.stringify(cfg));
  await page.locator('#apply-config').click();
  await expect(page.locator('#load-error')).toHaveText('');
  await page.locator('[data-view="Front"]').click();
  await dragHandle(page, 'key:matrix_ring_home', 0, 0);
  await expect(page.locator('#selection')).toContainText('ring column');
  const x = (await project(page)).config.geometry.columns.find((c: any) => c.name === 'ring')
    .offset_mm[0];
  await expect(
    page.locator('#selection label').filter({ hasText: 'X offset' }).locator('input'),
  ).toHaveValue(String(+x.toFixed(3)));
});
test('every commit kind is one undo step, and redo returns through them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const states = [await project(page)];
  const undo = page.locator('#undo'),
    redo = page.locator('#redo');
  // A column field edit.
  await page.locator('[data-view="Front"]').click();
  const h = await page.evaluate(() =>
    (window as any).rosebearEditor.handleScreen('key:matrix_ring_home'),
  );
  await page.mouse.click(h.x, h.y);
  const field = page
    .locator('#selection label')
    .filter({ hasText: 'home key height' })
    .locator('input');
  await field.fill(String(Number(await field.inputValue()) + 1));
  await field.press('Tab');
  states.push(await project(page));
  // The bottom-out field.
  await page.locator('#bottom-out').fill('3');
  await page.locator('#bottom-out').press('Tab');
  states.push(await project(page));
  // Apply configuration.
  const cfg = JSON.parse(await page.locator('#config').inputValue());
  cfg.switch.travel_mm += 0.1;
  await page.getByText('All configuration').click();
  await page.locator('#config').fill(JSON.stringify(cfg));
  await page.locator('#apply-config').click();
  states.push(await project(page));
  // Reset, then a file import.
  await page.locator('#reset').click();
  states.push(await project(page));
  await page.locator('#file').setInputFiles({
    name: 'p.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(states[1])),
  });
  await expect.poll(() => project(page)).toEqual(states[1]);
  states.push(states[1]);
  expect(new Set(states.map((s) => JSON.stringify(s))).size).toBe(4);
  for (let i = states.length - 2; i >= 0; i--) {
    await undo.click();
    expect(await project(page)).toEqual(states[i]);
  }
  await expect(undo).toBeDisabled();
  for (let i = 1; i < states.length; i++) {
    await redo.click();
    expect(await project(page)).toEqual(states[i]);
  }
  await expect(redo).toBeDisabled();
  await rebuilt(page);
  expect(errors).toEqual([]);
});
test('failure highlights take their colour from their kind', async ({ page }) => {
  const cfg = JSON.parse(await page.locator('#config').inputValue());
  cfg.switch.keycap_bottom_above_plate_mm = cfg.switch.travel_mm - 2;
  await page.getByText('All configuration').click();
  await page.locator('#config').fill(JSON.stringify(cfg));
  await page.locator('#apply-config').click();
  await rebuilt(page);
  const hl = await page.evaluate(() => (window as any).rosebearEditor.getHighlights());
  const colour: Record<string, number> = { rest: 0xff303e, travel: 0xffa124, room: 0xffa124 };
  const seen = new Set<string>();
  for (const h of hl) {
    seen.add(h.kind);
    expect(h.color, h.kind).toBe(colour[h.kind] ?? h.color);
  }
  expect(seen.has('rest') || seen.has('travel')).toBe(true);
  // The legend swatches match the meshes.
  const swatches = await page
    .locator('#fit-legend span')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  const rgb = (n: number) => `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
  expect(swatches).toEqual([0xff303e, 0xffa124, 0xf16bd8, 0x40e0ff].map(rgb));
});
test('prototype URL overrides are built and recorded in the saved report', async ({ page }) => {
  await page.goto('/?plates=narrow&slope=55&recess=1.5');
  await rebuilt(page);
  const saved = page.waitForEvent('download');
  await page.locator('#report').click();
  const fs = await import('node:fs/promises'),
    json = JSON.parse(await fs.readFile((await (await saved).path())!, 'utf8'));
  expect(json.evaluatedProject.config.chassis).toMatchObject({
    plate_style: 'narrow',
    plate_slope: 55,
    deck_lift: 1.5,
  });
  // The editable project itself never carries them.
  const own = (await project(page)).config.chassis;
  expect(own.plate_style).toBeUndefined();
  expect(own.deck_lift).toBeUndefined();
});
