import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProvenanceStore } from '@knowledge-studio/provenance';
import { Vault } from '@knowledge-studio/vault';
import type { FetchLike } from '@knowledge-studio/zotero';
import { TrustedNoteWriter } from '../electron/trusted-note-writer';
import { ZoteroHost } from '../electron/zotero-host';

let root = '';
let vault: Vault;
let writer: TrustedNoteWriter;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ks-zotero-host-'));
  const opened = await Vault.create(root);
  if (!opened.ok) throw opened.error;
  vault = opened.value;
  writer = new TrustedNoteWriter(vault, null);
});
afterEach(async () => {
  vault.close();
  await rm(root, { recursive: true, force: true });
});

const apiItems = (title: string): string =>
  JSON.stringify([
    {
      key: 'ITEM0001',
      library: { id: 1 },
      data: {
        itemType: 'journalArticle',
        title,
        creators: [{ firstName: 'Sara', lastName: 'Rahimi' }],
        date: '2024',
        citationKey: 'rahimi2024',
        tags: [{ tag: 'trees' }],
      },
    },
  ]);

describe('ZoteroHost', () => {
  it('imports an export file into literature notes with zotero provenance', async () => {
    const exportPath = path.join(root, '..', `ks-zotero-${Date.now()}.bib`);
    await writeFile(
      exportPath,
      '@article{karimi2023, title = {Paper One}, author = {Karimi, Ali}, year = 2023}\n',
    );
    const imported = await new ZoteroHost(writer).importFile(exportPath);
    await rm(exportPath, { force: true });
    expect(imported).toEqual({
      ok: true,
      value: {
        created: 1,
        updated: 0,
        unchanged: 0,
        failed: 0,
        paths: ['Literature/karimi2023.md'],
      },
    });
    const note = await readFile(path.join(root, 'Literature', 'karimi2023.md'), 'utf8');
    expect(note).toContain('zotero_key: karimi2023');
    const provenance = await new ProvenanceStore(vault).load();
    expect(provenance.ok && provenance.value.records[0]).toMatchObject({
      sourceType: 'zotero',
      origin: 'external',
      externalSourceId: 'zotero:karimi2023',
      citationKey: 'karimi2023',
      authors: ['Ali Karimi'],
      year: 2023,
      localRef: 'Literature/karimi2023.md',
    });
    expect((await new ZoteroHost(writer).importFile(path.join(root, 'x.exe'))).ok).toBe(false);
  });

  it('re-syncs idempotently: updates source fields in place, keeps user edits, follows renames', async () => {
    let title = 'Original title';
    const fake: FetchLike = (url) => {
      expect(url.startsWith('http://127.0.0.1:')).toBe(true);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(apiItems(title)),
      });
    };
    const host = new ZoteroHost(writer, fake);
    const first = await host.syncLocal(23119);
    expect(first.ok && first.value.created).toBe(1);
    const again = await host.syncLocal(23119);
    expect(again.ok && again.value).toMatchObject({ created: 0, unchanged: 1 });

    // User renames the note and adds their own notes and a tag.
    const original = await readFile(path.join(root, 'Literature', 'rahimi2024.md'), 'utf8');
    const edited = original
      .replace('tags:\n  - literature\n  - trees', 'tags:\n  - literature\n  - trees\n  - mine')
      .concat('My own reading notes.\n');
    await writeFile(path.join(root, 'Literature', 'rahimi2024.md'), edited);
    expect((await vault.rename('Literature/rahimi2024.md', 'Reading/Rahimi.md')).ok).toBe(true);

    title = 'Updated title';
    const updated = await host.syncLocal(23119);
    expect(updated.ok && updated.value).toMatchObject({
      created: 0,
      updated: 1,
      paths: ['Reading/Rahimi.md'],
    });
    const note = await readFile(path.join(root, 'Reading', 'Rahimi.md'), 'utf8');
    expect(note).toContain('title: Updated title');
    expect(note).toContain('- mine');
    expect(note).toContain('My own reading notes.');
    const feed = await writer.feed.changesSince();
    expect(feed.ok && feed.value.changes.map((change) => change.type)).toEqual([
      'source_imported',
      'source_updated',
    ]);
    const provenance = await new ProvenanceStore(vault).load();
    expect(provenance.ok && provenance.value.records).toHaveLength(1);
  });

  it('reports an unavailable local API without writing anything', async () => {
    const host = new ZoteroHost(writer, () => Promise.reject(new Error('ECONNREFUSED')));
    const result = await host.syncLocal(23119);
    expect(!result.ok && result.error.code).toBe('ZOTERO_UNAVAILABLE');
    expect((await host.syncLocal('23119')).ok).toBe(false);
  });
});
