import path from 'node:path';
import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, createTextPdf, launchFixture, type E2eFixture, waitForFile } from './fixture';

let fixture!: E2eFixture;
let launched = false;

test.beforeEach(async () => {
  fixture = await launchFixture('pdf', { 'papers/sample.pdf': createTextPdf('Sample Paper', ['Hello PDF world', 'Second page findings']) });
  launched = true;
});
test.afterEach(async () => { if (launched) { assertNoRuntimeErrors(fixture); await closeFixture(fixture); } launched = false; });

test('PDF reader renders, paginates, highlights, annotates, and exports cited notes', async () => {
  const { page, vault } = fixture;
  await page.getByRole('treeitem', { name: /sample\.pdf/ }).click();
  const dialog = page.getByRole('dialog', { name: 'PDF reader' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('2 pages');
  const textLayer = dialog.locator('.textLayer');
  await expect(textLayer).toContainText('Hello PDF world');
  await expect(dialog.locator('.pdf__page canvas')).toHaveJSProperty('width', 525);

  // Keyboard pagination.
  await dialog.locator('.pdf__viewport').focus();
  await page.keyboard.press('PageDown');
  await expect(dialog.getByText('Page 2 / 2')).toBeVisible();
  await expect(textLayer).toContainText('Second page findings');

  // Select text in the text layer and highlight it.
  await textLayer.locator('span', { hasText: 'Second page findings' }).first().evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await dialog.locator('select').selectOption('green');
  await dialog.getByRole('button', { name: 'Highlight selection' }).click();
  const annotations = dialog.getByRole('complementary', { name: 'Annotations' });
  await expect(annotations.locator('blockquote')).toHaveText('Second page findings');
  await expect(textLayer.locator('span[data-highlight="green"]')).toHaveCount(1);
  await annotations.getByLabel('Note').fill('یادداشت مهم');
  await annotations.getByRole('button', { name: 'Save note' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Note saved');

  const sidecar = await waitForFile(path.join(vault, 'papers', 'sample.pdf.ks-annotations.json'), (content) => content.includes('یادداشت مهم'));
  expect(sidecar).toContain('"page": 2');
  expect(await waitForFile(path.join(vault, '.knowledge-studio', 'provenance.json'), (content) => content.includes('"sourceType": "pdf"'))).toContain('Sample Paper');
  expect(await waitForFile(path.join(vault, '.knowledge-studio', 'change-feed.json'), (content) => content.includes('annotation_updated'))).toContain('annotation_created');

  await annotations.getByRole('button', { name: 'p. 2' }).click();
  await dialog.getByRole('button', { name: 'Export to note' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { name: 'sample annotations' })).toBeVisible();
  const note = await waitForFile(path.join(vault, 'papers', 'sample annotations.md'), (content) => content.includes('p. 2'));
  expect(note).toContain('> Second page findings\n> — Sample Paper, p. 2');
  expect(note).toContain('type: pdf-annotations');
});
