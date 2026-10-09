import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, launchFixture, type E2eFixture } from './fixture';

let fixture: E2eFixture;

test.beforeEach(async () => {
  fixture = await launchFixture('minimal');
});

test.afterEach(async () => {
  assertNoRuntimeErrors(fixture);
  await closeFixture(fixture);
});

test('launches Electron with preload bridge and normal workbench', async () => {
  await expect(fixture.page.getByText('Knowledge Studio', { exact: true }).first()).toBeVisible();
  await expect(fixture.page.locator('.workbench')).toBeVisible();
  await expect(fixture.page.getByRole('button', { name: 'Graph' })).toBeVisible();
  await expect(fixture.page.getByRole('button', { name: 'Canvas' })).toBeVisible();
  expect(
    await fixture.page.evaluate(() => {
      const windowRef = window as unknown as { knowledgeStudio?: unknown };
      return Boolean(windowRef.knowledgeStudio);
    }),
  ).toBe(true);
});
