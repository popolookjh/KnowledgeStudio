import path from 'node:path';
import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, launchFixture, type E2eFixture, waitForFile } from './fixture';

let fixture!: E2eFixture;
let launched = false;

test.beforeEach(async () => {
  fixture = await launchFixture('bases', {
    'Projects/Alpha.md': '---\ntitle: Alpha\nstatus: todo\n---\nAlpha body\n',
    'Projects/Beta.md': '---\ntitle: Beta\nstatus: doing\n---\nBeta body\n',
    'Projects/پروژه.md': '---\ntitle: پروژه نمونه\nstatus: todo\n---\nمتن فارسی\n',
  });
  launched = true;
});
test.afterEach(async () => { if (launched) { assertNoRuntimeErrors(fixture); await closeFixture(fixture); } launched = false; });

test('Bases table inline edit, cards, RTL keyboard Kanban, and trusted persistence', async () => {
  const { page, vault } = fixture;
  await page.getByRole('button', { name: 'Bases', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bases' });
  await expect(dialog).toBeVisible();

  const form = dialog.getByRole('form', { name: 'Create base' });
  await form.getByLabel('Name').fill('پروژه‌ها');
  await form.getByLabel('Folder').fill('Projects');
  await form.getByLabel('Fields').fill('status');
  await form.getByLabel('Group by').fill('status');
  await form.getByRole('button', { name: 'Create base' }).click();

  const table = dialog.locator('table.bases__table');
  await expect(table.locator('caption')).toContainText('3 rows');
  await expect(dialog.locator('.bases')).toHaveAttribute('dir', 'rtl');
  await expect(table.getByRole('button', { name: 'پروژه نمونه' })).toHaveAttribute('dir', 'auto');

  // Inline metadata edit via keyboard through the trusted main-process path.
  const alphaStatus = table.locator('tr', { hasText: 'Alpha' }).getByRole('button', { name: /^status: todo/ });
  await alphaStatus.focus();
  await page.keyboard.press('Enter');
  const input = dialog.getByLabel('Edit status for Alpha');
  await input.fill('done');
  await input.press('Enter');
  expect(await waitForFile(path.join(vault, 'Projects', 'Alpha.md'), (content) => content.includes('status: done'))).toContain('Alpha body');
  await expect(dialog.getByRole('status')).toContainText('Updated status for Alpha');

  await dialog.getByRole('tab', { name: 'Cards' }).click();
  await expect(dialog.locator('article.bases__card')).toHaveCount(3);

  await dialog.getByRole('tab', { name: 'Kanban' }).click();
  await expect(dialog.getByRole('tab', { name: 'Kanban' })).toHaveAttribute('aria-selected', 'true');
  const beta = dialog.locator('.bases__kanban-card', { hasText: 'Beta' });
  await expect(beta).toHaveAttribute('aria-label', 'Beta, status: doing');
  await beta.focus();
  // RTL board: ArrowLeft moves toward the next column in reading order (doing → done).
  await page.keyboard.press('ArrowLeft');
  expect(await waitForFile(path.join(vault, 'Projects', 'Beta.md'), (content) => content.includes('status: done'))).not.toBeNull();
  await expect(dialog.getByRole('status')).toContainText('Moved Beta to done');
  await expect(dialog.locator('.bases__kanban-card', { hasText: 'Beta' })).toBeFocused();
  await expect(dialog.locator('.bases__kanban-card', { hasText: 'Beta' })).toHaveAttribute('aria-label', 'Beta, status: done');
  await page.keyboard.press('ArrowUp');
  await expect(dialog.locator('.bases__kanban-card', { hasText: 'Alpha' })).toBeFocused();

  const definitionFile = await waitForFile(path.join(vault, '.knowledge-studio', 'bases', `${await baseId(fixture)}.json`), (content) => content.includes('"view": "kanban"'));
  expect(definitionFile).toContain('پروژه‌ها');
  const feed = await waitForFile(path.join(vault, '.knowledge-studio', 'change-feed.json'), (content) => (content.match(/metadata_changed/g) ?? []).length >= 2);
  expect(feed).not.toBeNull();

  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toBeHidden();
});

async function baseId(target: E2eFixture): Promise<string> {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(path.join(target.vault, '.knowledge-studio', 'bases'));
  return files[0]!.replace(/\.json$/, '');
}
