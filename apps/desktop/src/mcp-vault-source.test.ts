import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReadOnlyMcpServer, type RetrievalHit } from '@knowledge-studio/mcp';
import { Vault } from '@knowledge-studio/vault';
import { BasesHost } from '../electron/bases-host';
import { WebClipperHost } from '../electron/clipper-host';
import { createVaultMcpDataSource } from '../electron/mcp-vault-source';
import { PdfHost } from '../electron/pdf-host';
import { TrustedNoteWriter } from '../electron/trusted-note-writer';

let root = '';
let vault: Vault;
let writer: TrustedNoteWriter;
let server: ReadOnlyMcpServer | null = null;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ks-mcp-v2-'));
  const opened = await Vault.create(root);
  if (!opened.ok) throw opened.error;
  vault = opened.value;
  writer = new TrustedNoteWriter(vault, null);
  await writer.write(
    'Research/Trees.md',
    '---\ntitle: Tree study\nstatus: open\n---\n# Methods\nWe measured trunk diameter.\n\n## Results\nMean diameter was 42 cm.\n',
  );
  await writer.write(
    'Research/فارسی.md',
    '---\ntitle: پژوهش درختان\nstatus: done\n---\n## نتایج\nقطر میانگین ۴۲ سانتی‌متر بود.\n',
  );
  await mkdir(path.join(root, 'papers'));
  await writeFile(path.join(root, 'papers', 'p.pdf'), '%PDF-1.4\n');
});
afterEach(async () => {
  await server?.stop();
  server = null;
  vault.close();
  await rm(root, { recursive: true, force: true });
});

describe('MCP Retrieval V2 vault source', () => {
  it('retrieves cited passages via FTS candidates or a full scan', async () => {
    const scan = createVaultMcpDataSource(vault);
    const hits = await scan.retrieve('diameter results', 5);
    expect(hits[0]).toMatchObject({
      path: 'Research/Trees.md',
      title: 'Tree study',
      locator: { heading: 'Results' },
      citation: 'Tree study § Results',
    });
    expect(hits[0]!.sourceId).toMatch(new RegExp(`^ks:${vault.vaultId}:`));
    expect(hits[0]!.locator.chunkId).toBe(`${hits[0]!.documentId!}#c1`);
    const persian = await scan.retrieve('قطر', 5);
    expect(persian.map((hit) => hit.path)).toEqual(['Research/فارسی.md']);
    const viaIndex = createVaultMcpDataSource(vault, { searchPaths: () => ['Research/فارسی.md'] });
    expect(await viaIndex.retrieve('diameter', 5)).toEqual([]);
  });

  it('resolves markdown, web, and pdf citations and exposes changes, annotations, and bases', async () => {
    const bases = new BasesHost(writer);
    await bases.save(
      {
        schemaVersion: 1,
        id: 'research',
        name: 'Research',
        view: 'table',
        folder: 'Research',
        filters: [],
        fields: ['status'],
      },
      undefined,
    );
    const clip = await new WebClipperHost(writer).clip({
      html: '<h1>Web</h1><p>clip</p>',
      url: 'https://example.com/w',
    });
    const pdf = await new PdfHost(writer).add(
      'papers/p.pdf',
      { page: 3, quote: 'Q', color: 'yellow' },
      0,
    );
    if (!clip.ok || !pdf.ok) throw new Error('setup failed');
    const source = createVaultMcpDataSource(vault, { changeFeed: writer.feed, bases });
    const markdownHit = (await source.retrieve('diameter', 1))[0]!;
    expect(await source.resolveCitation(markdownHit.sourceId!)).toMatchObject({
      resolution: { state: 'resolved', path: 'Research/Trees.md' },
    });
    expect(await source.resolveCitation(clip.value.sourceId)).toMatchObject({
      record: { sourceType: 'web', url: 'https://example.com/w' },
      resolution: { state: 'resolved', path: clip.value.path },
    });
    expect(await source.resolveCitation(pdf.value.sourceId)).toMatchObject({
      record: { sourceType: 'pdf' },
      resolution: { state: 'resolved', path: 'papers/p.pdf' },
    });
    expect(await source.resolveCitation('ks:other-vault:x')).toMatchObject({
      resolution: { state: 'invalid' },
    });
    const changes = (await source.listChanges(undefined, 2)) as {
      changes: { type: string }[];
      hasMore: boolean;
      cursor: string;
    };
    expect(changes.changes.map((change) => change.type)).toEqual([
      'document_created',
      'document_created',
    ]);
    expect(changes.hasMore).toBe(true);
    const next = (await source.listChanges(changes.cursor, 10)) as { changes: { type: string }[] };
    expect(next.changes.map((change) => change.type)).toEqual([
      'source_imported',
      'annotation_created',
    ]);
    expect(await source.listAnnotations('papers/p.pdf')).toMatchObject({
      sourceId: pdf.value.sourceId,
      annotations: [{ page: 3, citation: 'p.pdf, p. 3' }],
    });
    expect(await source.listAnnotations('../x.pdf')).toEqual({ error: 'PDF_PATH_INVALID' });
    expect(await source.queryBase('research')).toMatchObject({ total: 2 });
    expect(JSON.stringify(await source.queryBase('research'))).not.toContain('trunk diameter');
  });

  it('serves V2 tools over loopback JSON-RPC end to end', async () => {
    server = new ReadOnlyMcpServer(createVaultMcpDataSource(vault, { changeFeed: writer.feed }), {
      port: 0,
    });
    await server.start();
    const response = await fetch(`${server.endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'retrieve', arguments: { query: 'mean diameter' } },
      }),
    });
    const body = (await response.json()) as {
      id: number;
      result: { structuredContent: { result: RetrievalHit[] } };
    };
    expect(body.id).toBe(7);
    expect(body.result.structuredContent.result[0]!.passage).toContain('Mean diameter was 42 cm.');
  });
});
