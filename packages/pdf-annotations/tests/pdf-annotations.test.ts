import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Vault } from '@knowledge-studio/vault';
import {
  annotationsToMarkdown,
  isPdfPath,
  parseAnnotationPatch,
  parseNewAnnotation,
  PdfAnnotationStore,
  sidecarPath,
} from '../src/index.js';

let root = '';
let vault: Vault;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ks-pdf-ann-'));
  const opened = await Vault.create(root);
  if (!opened.ok) throw opened.error;
  vault = opened.value;
});
afterEach(async () => {
  vault.close();
  await rm(root, { recursive: true, force: true });
});

describe('validation', () => {
  it('accepts well-formed annotations and rejects malformed input', () => {
    expect(parseNewAnnotation({ page: 2, quote: '  متن   انتخابی ', color: 'yellow' })).toEqual({
      ok: true,
      value: { page: 2, quote: 'متن انتخابی', color: 'yellow' },
    });
    expect(parseNewAnnotation({ page: 0, quote: 'x', color: 'yellow' }).ok).toBe(false);
    expect(parseNewAnnotation({ page: 1, quote: '', color: 'yellow' }).ok).toBe(false);
    expect(parseNewAnnotation({ page: 1, quote: 'x', color: 'red; drop' }).ok).toBe(false);
    expect(parseNewAnnotation({ page: 1.5, quote: 'x', color: 'blue' }).ok).toBe(false);
    expect(parseAnnotationPatch({ color: 'nope' }).ok).toBe(false);
    expect(isPdfPath('papers/a.pdf')).toBe(true);
    expect(isPdfPath('../a.pdf')).toBe(false);
    expect(isPdfPath('C:\\a.pdf')).toBe(false);
    expect(isPdfPath('a.md')).toBe(false);
  });
});

describe('PdfAnnotationStore', () => {
  it('persists a vault sidecar with revisions, updates, deletes, and a stable source key', async () => {
    const store = new PdfAnnotationStore(vault);
    const empty = await store.load('papers/paper.pdf');
    expect(empty.ok && empty.value.revision).toBe(0);
    const added = await store.add(
      'papers/paper.pdf',
      { page: 3, quote: 'Important finding', color: 'yellow' },
      0,
    );
    if (!added.ok) throw new Error(added.error.message);
    const sourceKey = added.value.file.sourceKey;
    expect(
      (await store.add('papers/paper.pdf', { page: 1, quote: 'stale', color: 'blue' }, 0)).ok,
    ).toBe(false);
    const second = await store.add(
      'papers/paper.pdf',
      { page: 1, quote: 'Intro', color: 'green', note: 'context' },
      1,
    );
    expect(second.ok && second.value.file.annotations.map((annotation) => annotation.page)).toEqual(
      [1, 3],
    );
    const updated = await store.update(
      'papers/paper.pdf',
      added.value.annotation.id,
      { note: 'یادداشت', color: 'pink' },
      2,
    );
    expect(updated.ok && updated.value.annotation).toMatchObject({
      note: 'یادداشت',
      color: 'pink',
      quote: 'Important finding',
    });
    const raw = JSON.parse(
      await readFile(path.join(root, sidecarPath('papers/paper.pdf')), 'utf8'),
    ) as { sourceKey: string; revision: number };
    expect(raw).toMatchObject({ sourceKey, revision: 3 });
    const removed = await store.remove('papers/paper.pdf', added.value.annotation.id, 3);
    expect(removed.ok && removed.value.annotations).toHaveLength(1);
    expect((await store.remove('papers/paper.pdf', 'missing', 4)).ok).toBe(false);
  });

  it('rejects tampered sidecars', async () => {
    await writeFile(
      path.join(root, 'x.pdf.ks-annotations.json'),
      JSON.stringify({
        format: 'knowledge-studio.pdf-annotations',
        schemaVersion: 1,
        pdfPath: 'other.pdf',
        sourceKey: 'x',
        revision: 1,
        annotations: [],
      }),
    );
    expect((await new PdfAnnotationStore(vault).load('x.pdf')).ok).toBe(false);
  });

  it('exports escaped Markdown quotes with page citations', async () => {
    const store = new PdfAnnotationStore(vault);
    const added = await store.add(
      'a.pdf',
      { page: 7, quote: 'a <b> *c*', color: 'blue', note: 'why' },
      0,
    );
    if (!added.ok) throw new Error('add failed');
    const markdown = annotationsToMarkdown('Paper', 'a.pdf', added.value.file, 'ks:v:s');
    expect(markdown).toContain('> a \\<b\\> \\*c\\*\n> — Paper, p. 7\n\nwhy');
  });
});
