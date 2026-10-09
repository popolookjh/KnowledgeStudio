import http from 'node:http';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  assertNoRuntimeErrors,
  closeFixture,
  launchFixture,
  type E2eFixture,
  waitForFile,
} from './fixture';

let fixture!: E2eFixture;
let launched = false;
let zotero: http.Server | null = null;
const requests: string[] = [];

test.beforeEach(async () => {
  fixture = await launchFixture('zotero');
  launched = true;
});
test.afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (zotero) zotero.close(() => resolve());
    else resolve();
  });
  zotero = null;
  if (launched) {
    assertNoRuntimeErrors(fixture);
    await closeFixture(fixture);
  }
  launched = false;
});

test('Zotero local API sync creates, then updates, literature notes idempotently', async () => {
  let title = 'درختان شهری';
  zotero = http.createServer((request, response) => {
    requests.push(
      `${request.method ?? ''} ${request.url ?? ''} ${String(request.headers['zotero-api-version'] ?? '')}`,
    );
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify([
        {
          key: 'E2EITEM1',
          library: { id: 1 },
          data: {
            itemType: 'journalArticle',
            title,
            creators: [{ firstName: 'Sara', lastName: 'Rahimi' }],
            date: '2024',
            citationKey: 'rahimi2024',
            DOI: '10.1/e2e',
          },
        },
      ]),
    );
  });
  await new Promise<void>((resolve) => zotero!.listen(0, '127.0.0.1', () => resolve()));
  const address = zotero.address();
  if (!address || typeof address === 'string') throw new Error('no port');

  const { page, vault } = fixture;
  const panel = page.locator('.zotero-panel');
  await panel.getByLabel('Local API port').fill(String(address.port));
  await panel.getByRole('button', { name: 'Sync from Zotero' }).click();
  await expect(panel.getByRole('status')).toHaveText('Zotero: 1 created, 0 updated, 0 unchanged');
  await expect(page.getByRole('tab', { name: 'rahimi2024' })).toBeVisible();
  expect(requests[0]).toBe('GET /api/users/0/items/top?format=json&limit=100 3');
  const note = await waitForFile(path.join(vault, 'Literature', 'rahimi2024.md'), (content) =>
    content.includes('zotero_key'),
  );
  expect(note).toContain('title: درختان شهری');
  expect(note).toContain('doi: 10.1/e2e');

  title = 'Urban trees (revised)';
  await panel.getByRole('button', { name: 'Sync from Zotero' }).click();
  await expect(panel.getByRole('status')).toHaveText('Zotero: 0 created, 1 updated, 0 unchanged');
  expect(
    await waitForFile(path.join(vault, 'Literature', 'rahimi2024.md'), (content) =>
      content.includes('Urban trees (revised)'),
    ),
  ).not.toBeNull();
  expect(
    await waitForFile(path.join(vault, '.knowledge-studio', 'provenance.json'), (content) =>
      content.includes('"externalSourceId": "zotero:1:E2EITEM1"'),
    ),
  ).not.toBeNull();
  expect(
    await waitForFile(path.join(vault, '.knowledge-studio', 'change-feed.json'), (content) =>
      content.includes('source_updated'),
    ),
  ).toContain('source_imported');

  zotero.close();
  zotero = null;
  await panel.getByRole('button', { name: 'Sync from Zotero' }).click();
  await expect(panel.getByRole('status')).toContainText('Zotero is not running');
});
