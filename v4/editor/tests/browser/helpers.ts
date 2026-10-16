import { expect, type Page } from '@playwright/test';

/** The editor's whole project, as the app holds it. */
export const project = (page: Page) =>
  page.evaluate(() => (window as any).rosebearEditor.getProject());

/** Waits for the geometry worker to finish a build. */
export const rebuilt = (page: Page) =>
  expect(page.locator('#view-state')).toContainText('Chassis rebuilt', { timeout: 30000 });
