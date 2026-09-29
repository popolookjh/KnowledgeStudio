import path from 'node:path';
import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, launchFixture, type E2eFixture, waitForFile } from './fixture';

let fixture!: E2eFixture;
let launched = false;

test.beforeEach(async () => { fixture = await launchFixture('clipper'); launched = true; });
test.afterEach(async () => { if (launched) { assertNoRuntimeErrors(fixture); await closeFixture(fixture); } launched = false; });

test('web clip is sanitized, saved offline with provenance, and opened', async () => {
  const { page, vault } = fixture;
  const panel = page.locator('.clip-panel');
  await panel.getByLabel('Clip content').fill('<h1>Clip Title</h1><p>Clipped <b>body</b> متن <img src="https://tracker.example/pixel.png" alt="pixel"><script>alert(1)</script></p>');
  await panel.getByLabel('Source URL').fill('https://example.com/article');
  await panel.getByRole('button', { name: 'Save clip' }).click();
  await expect(panel.getByRole('status')).toContainText('Clipped to Clippings/Clip Title.md');
  await expect(page.getByRole('tab', { name: 'Clip Title' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /Clip Title\.md/ })).toBeVisible();

  const note = await waitForFile(path.join(vault, 'Clippings', 'Clip Title.md'), (content) => content.includes('Clipped **body**'));
  expect(note).toContain('source: https://example.com/article');
  expect(note).toContain('type: web-clip');
  expect(note).toContain('[Image: pixel](https://tracker.example/pixel.png)');
  expect(note).not.toContain('alert');
  expect(await waitForFile(path.join(vault, '.knowledge-studio', 'provenance.json'), (content) => content.includes('"sourceType": "web"'))).toContain('https://example.com/article');
  expect(await waitForFile(path.join(vault, '.knowledge-studio', 'change-feed.json'), (content) => content.includes('source_imported'))).not.toBeNull();

  // The preview shows the image as a link, so no remote request is attempted (fixture asserts none).
  await page.getByRole('button', { name: 'preview' }).click();
  await expect(page.locator('.preview').getByText('Clip Title').first()).toBeVisible();
});
