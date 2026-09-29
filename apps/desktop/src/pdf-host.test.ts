import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProvenanceStore } from '@knowledge-studio/provenance';
import { Vault } from '@knowledge-studio/vault';
import { PdfHost } from '../electron/pdf-host';
import { TrustedNoteWriter } from '../electron/trusted-note-writer';

let root = '';
let vault: Vault;
let writer: TrustedNoteWriter;
let host: PdfHost;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ks-pdf-host-'));
  const opened = await Vault.create(root);
  if (!opened.ok) throw opened.error;
  vault = opened.value;
  await mkdir(path.join(root, 'papers'));
  await writeFile(path.join(root, 'papers', 'a.pdf'), '%PDF-1.4\n%fake body for host tests\n');
  await writeFile(path.join(root, 'papers', 'fake.pdf'), 'MZ not a pdf');
  writer = new TrustedNoteWriter(vault, null);
  host = new PdfHost(writer);
});
afterEach(async () => { vault.close(); await rm(root, { recursive: true, force: true }); });

describe('PdfHost', () => {
  it('reads only vault-relative PDFs with a PDF signature', async () => {
    const read = await host.read('papers/a.pdf');
    expect(read.ok && read.value.bytes.byteLength).toBeGreaterThan(5);
    expect((await host.read('papers/fake.pdf')).ok).toBe(false);
    expect((await host.read('../outside.pdf')).ok).toBe(false);
    expect((await host.read('papers/a.md')).ok).toBe(false);
    expect((await host.read({ path: 'papers/a.pdf' })).ok).toBe(false);
  });

  it('annotates, registers pdf provenance once, emits annotation changes, and exports a cited note', async () => {
    expect((await host.add('papers/missing.pdf', { page: 1, quote: 'x', color: 'yellow' }, 0)).ok).toBe(false);
    const first = await host.add('papers/a.pdf', { page: 1, quote: 'First quote', color: 'yellow' }, 0, 'Paper A');
    if (!first.ok) throw new Error(first.error.message);
    const second = await host.add('papers/a.pdf', { page: 4, quote: 'Second', color: 'blue', note: 'n' }, first.value.revision);
    if (!second.ok) throw new Error(second.error.message);
    const id = second.value.annotations[1]!.id;
    expect((await host.update('papers/a.pdf', id, { note: 'changed' }, second.value.revision)).ok).toBe(true);
    expect((await host.remove('papers/a.pdf', first.value.annotations[0]!.id, 3)).ok).toBe(true);
    const provenance = await new ProvenanceStore(vault).load();
    expect(provenance.ok && provenance.value.records.map((record) => [record.sourceType, record.title, record.sourceId])).toEqual([['pdf', 'Paper A', first.value.sourceId]]);
    const feed = await writer.feed.changesSince();
    expect(feed.ok && feed.value.changes.map((change) => change.type)).toEqual(['annotation_created', 'annotation_created', 'annotation_updated', 'annotation_deleted']);
    const exported = await host.exportNote('papers/a.pdf', 'Paper A');
    expect(exported.ok && exported.value.path).toBe('papers/a annotations.md');
    const again = await host.exportNote('papers/a.pdf', 'Paper A');
    expect(again.ok && again.value.path).toBe('papers/a annotations 2.md');
    const note = await readFile(path.join(root, 'papers', 'a annotations.md'), 'utf8');
    expect(note).toContain(`source_id: ${first.value.sourceId}`);
    expect(note).toContain('> — Paper A, p. 4');
  });
});
