import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProvenanceStore } from '@knowledge-studio/provenance';
import { Vault } from '@knowledge-studio/vault';
import { WebClipperHost } from '../electron/clipper-host';
import { TrustedNoteWriter } from '../electron/trusted-note-writer';

let root = '';
let vault: Vault;
let writer: TrustedNoteWriter;
let host: WebClipperHost;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ks-clipper-host-'));
  const opened = await Vault.create(root);
  if (!opened.ok) throw opened.error;
  vault = opened.value;
  writer = new TrustedNoteWriter(vault, null);
  host = new WebClipperHost(writer);
});
afterEach(async () => {
  vault.close();
  await rm(root, { recursive: true, force: true });
});

describe('WebClipperHost', () => {
  it('writes a clip note with identity, web provenance, and a source_imported change', async () => {
    const clipped = await host.clip(
      { html: '<h1>مقاله</h1><p>Body <script>alert(1)</script></p>', url: 'https://example.com/a' },
      new Date('2026-09-29T00:00:00Z'),
    );
    if (!clipped.ok) throw new Error(clipped.error.message);
    expect(clipped.value.path).toBe('Clippings/مقاله.md');
    const content = await readFile(path.join(root, 'Clippings', 'مقاله.md'), 'utf8');
    expect(content).toContain(`id: ${clipped.value.documentId}`);
    expect(content).toContain('source: https://example.com/a');
    expect(content).not.toContain('alert');
    const provenance = await new ProvenanceStore(vault).load();
    expect(
      provenance.ok &&
        provenance.value.records.map((record) => [record.sourceType, record.sourceId, record.url]),
    ).toEqual([['web', clipped.value.sourceId, 'https://example.com/a']]);
    const resolved = await new ProvenanceStore(vault).resolveSourceProvenance(
      clipped.value.sourceId,
    );
    expect(resolved.ok && resolved.value.state).toBe('resolved');
    const feed = await writer.feed.changesSince();
    expect(
      feed.ok && feed.value.changes.map((change) => [change.type, change.path, change.documentId]),
    ).toEqual([['source_imported', 'Clippings/مقاله.md', clipped.value.documentId]]);
  });

  it('never overwrites an existing clip and rejects unsafe input', async () => {
    const first = await host.clip({ html: '<h1>Same</h1><p>one</p>' });
    const second = await host.clip({ html: '<h1>Same</h1><p>two</p>' });
    expect(first.ok && first.value.path).toBe('Clippings/Same.md');
    expect(second.ok && second.value.path).toBe('Clippings/Same 2.md');
    expect((await host.clip({ html: '<p>x</p>', url: 'javascript:alert(1)' })).ok).toBe(false);
    expect((await host.clip({ html: '<script>only()</script>' })).ok).toBe(false);
    expect((await host.clip(null)).ok).toBe(false);
  });

  it('imports saved pages by extension and size only', async () => {
    const saved = path.join(root, '..', `ks-saved-${Date.now()}.html`);
    await writeFile(
      saved,
      '<html><head><title>Saved Page</title></head><body><p>Saved body</p></body></html>',
    );
    const imported = await host.clipFile(saved);
    expect(imported.ok && imported.value.path).toBe('Clippings/Saved Page.md');
    expect((await host.clipFile(path.join(root, 'x.exe'))).ok).toBe(false);
    await rm(saved, { force: true });
  });
});
