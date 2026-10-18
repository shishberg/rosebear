import { expect, type Page } from '@playwright/test';
import preSwungConfig from '../pre-swung-config.json' with { type: 'json' };

/** The editor's whole project, as the app holds it. */
export const project = (page: Page) =>
  page.evaluate(() => (window as any).rosebearEditor.getProject());

/** Waits for the geometry worker to finish a build. */
export const rebuilt = (page: Page) =>
  expect(page.locator('#view-state')).toContainText('Chassis rebuilt', { timeout: 30000 });

/** Opens the layout before Swung in became the default (tests/pre-swung-config.json),
 * as an autosave, for tests of the editor rather than the layout. It passes, and
 * builds in about a second; Swung in takes 15 s or more, most of it the wire
 * router failing to part its crossing wires. */
export async function usePreSwung(page: Page) {
  await page.evaluate(
    (config) =>
      localStorage.setItem('rosebear-chassis-editor:v2', JSON.stringify({ version: 2, config })),
    preSwungConfig,
  );
  await page.reload();
  await rebuilt(page);
}
