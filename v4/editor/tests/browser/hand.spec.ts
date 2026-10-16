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

const PANEL = [
  '-- basic',
  'buttons Dactyl fit, Natural, Yours, No curl',
  'buttons Copy settings, Paste settings',
  'radios Fingers on top=top, home=home, bottom=bottom',
  'radios Thumb on rest=rest, far=far, home=home, near=near, x1=x1, x2=x2',
  'check Show the thumb pressing it (its last 15 mm onto the key)',
  'radios Rotation handle: hand=hand, off=off',
  'h3 Basic',
  'slider finger curl (°, + curled) [-30, 40, 1]',
  "slider wrist height (mm, the thumb's CMC above the home row) [-30, 130, 0.5]",
  'slider key spacing (mm, every gap) [12, 30, 0.5]',
  'slider thumb keys round the arc (°, + away from the fingers; rest 112, swept in 92) [70, 180, 1]',
  'slider thumb keys below the home row (mm) [-20, 50, 0.5]',
  'slider thumb reach: palmar abduction per degree of radial abduction (+ lowers it swinging out) [-2, 2, 0.05]',
  'slider thumb reach: curl per degree of radial abduction [-2, 2, 0.05]',
  'slider thumb press: from palmar abduction (0°) toward curling (90°; − straightening) [-90, 90, 1]',
  "check Far and near thumb keys' edges parallel to the home key's (tilted only along the row)",
  'radios Thumb keys 1×3=1×3, 1.5u + 2×1u=1.5u + 2×1u',
  "check Extra thumb keys x1, x2: a second row under the gaps, toward the thumb's base",
  "slider extra thumb keys: mm from the row toward the thumb's base (centre to centre, across the faces) [15, 60, 0.5] off",
  "slider extra thumb keys: tilt from the row (° about it, + facing the thumb's base and palm) [-30, 90, 1] off",
  'slider extra thumb keys: lower (mm, along the keycap normal) [-5, 10, 0.5] off',
  'slider extra thumb keys: press (as the thumb press) [-90, 90, 1] off',
  'check Advanced settings',
  'check Build the case (often fails)',
  'check Test frame (print this way up, with supports)',
  'buttons Right STL, Left STL',
  '-- advanced',
  'h3 Hand on the board (°)',
  'slider tent [0, 45, 1]',
  'slider roll: + pinky side down [-30, 30, 1]',
  'slider pitch: + far edge down [-25, 25, 1]',
  'slider wrist bend: + toward the pinky [-25, 25, 1]',
  'h3 Curl at home (°, + curled)',
  'slider index [-30, 40, 1]',
  'slider middle [-30, 40, 1]',
  'slider ring [-30, 40, 1]',
  'slider pinky [-30, 40, 1]',
  'slider inner column gap (mm) [18, 30, 0.5]',
  'slider inner column angle (°, + to thumb) [-10, 30, 1]',
  'h3 Rows (mm from home)',
  'radios Rows reached from the reach=wrist height, press=press mix',
  'slider press mix: PIP+DIP° per MCP° [-1, 4, 0.1] off',
  'slider top: forward [5, 35, 1]',
  'slider bottom: back [5, 35, 1]',
  'h3 Thumb',
  'slider key spacing (mm) [17, 40, 0.5]',
  'slider 1u row gap (mm, + toward the palm) [-35, 35, 0.5] off',
];
// The panel's controls, in order, with their labels and ranges (a slider's
// min, max, step), as the DOM has them.
const PANEL_SCRIPT = () => {
  const out: string[] = [];
  const one = (el: Element) => {
    if (el.tagName === 'H3') return out.push(`h3 ${el.textContent}`);
    const range = el.querySelector<HTMLInputElement>('input[type=range]');
    if (el.tagName === 'LABEL' && range)
      return out.push(
        `slider ${el.querySelector('span')!.textContent} [${range.min}, ${range.max}, ${range.step}]${range.disabled ? ' off' : ''}`,
      );
    if (el.tagName === 'LABEL' && el.querySelector('input[type=checkbox]'))
      return out.push(`check ${el.textContent!.trim()}`);
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    if (radios.length)
      return out.push(
        `radios ${el.firstChild!.textContent!.trim()} ${radios.map((r) => `${r.value}=${r.parentElement!.textContent}`).join(', ')}`,
      );
    const buttons = [...el.querySelectorAll('button')];
    if (buttons.length) return out.push(`buttons ${buttons.map((b) => b.textContent).join(', ')}`);
  };
  const sec = [...document.querySelectorAll('aside section')].find((x) =>
    x.querySelector('#hand-note'),
  )!;
  const [basic, advanced] = [...sec.children].filter(
    (x) => x.tagName === 'DIV' && x.id !== 'hand-note',
  );
  for (const box of [basic, advanced]) {
    out.push(`-- ${box === basic ? 'basic' : 'advanced'}`);
    for (const el of box.children) one(el);
  }
  return out;
};

test('the hand panel keeps its controls, labels and ranges, and each type edits the layout', async ({
  page,
}) => {
  await page.goto('/?hand');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const note = page.locator('#hand-note');
  await expect(note).toContainText('Valid (', { timeout: 30000 });
  expect(await page.evaluate(PANEL_SCRIPT)).toEqual(PANEL);
  const hand = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { rosebearEditor: { getProject(): { hand: any } } }
        ).rosebearEditor.getProject().hand,
    );
  // A slider: input events edit the state live, a drag is one Undo step.
  await page.getByLabel('Advanced settings').check();
  const tent = page.locator('label', { hasText: /^tent/ }).locator('input'),
    was = (await hand()).tent;
  await tent.fill('20');
  await expect(tent).toHaveValue('20');
  expect((await hand()).tent).toBe(20);
  await page.locator('#undo').click();
  expect((await hand()).tent).toBe(was);
  // A drag (two input events, then a change) is one Undo step.
  await tent.evaluate((el: HTMLInputElement) => {
    for (const v of ['25', '30']) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect((await hand()).tent).toBe(30);
  await page.locator('#undo').click();
  expect((await hand()).tent).toBe(was);
  // One slider for several settings moves them all by the same amount.
  const curl = page.locator('label', { hasText: 'finger curl (°' }).locator('input'),
    curls = Object.values((await hand()).curl as Record<string, number>);
  await curl.focus();
  await page.keyboard.press('ArrowRight');
  const moved = Object.values((await hand()).curl as Record<string, number>).map(
    (v, i) => v - curls[i],
  );
  expect(moved[0]).not.toBe(0);
  expect(moved).toEqual(moved.map(() => moved[0]));
  // A radio group and a checkbox.
  await page.getByRole('radio', { name: '1.5u + 2×1u' }).check();
  expect((await hand()).cluster).toBe('1.5u + 2×1u');
  const parallel = !!(await hand()).thumb.parallel;
  await page.getByLabel(/Far and near thumb keys' edges parallel/).setChecked(!parallel);
  expect(!!(await hand()).thumb.parallel).toBe(!parallel);
  // Sliders are enabled as the settings they depend on are set.
  const off = async () =>
    (await page.evaluate(PANEL_SCRIPT))
      .filter((x) => x.startsWith('slider ') && x.endsWith(' off'))
      .map((x) => x.slice(7).split(' [')[0]);
  expect(await off()).not.toContain('1u row gap (mm, + toward the palm)');
  await page.getByLabel(/Extra thumb keys x1, x2/).check();
  expect((await off()).filter((x) => x.startsWith('extra thumb keys'))).toEqual([]);
  expect(await off()).toContain('press mix: PIP+DIP° per MCP°');
  await page.getByRole('radio', { name: 'press mix' }).check();
  expect(await off()).not.toContain('press mix: PIP+DIP° per MCP°');
  expect(await off()).toContain("wrist height (mm, the thumb's CMC above the home row)");
});
