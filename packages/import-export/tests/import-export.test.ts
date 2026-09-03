import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { enumeratePortableFolder, exportFolder, importFolder, readUtf8, writeUtf8 } from '../src/index.js';

async function folder(): Promise<string> { return mkdtemp(path.join(tmpdir(), 'ks-transfer-')); }

describe('portable import/export', () => {
  it('enumerates Markdown, attachments, Unicode and skips app directories', async () => {
    const root = await folder(); await mkdir(path.join(root, 'یادداشت‌ها'), { recursive: true }); await writeFile(path.join(root, 'یادداشت‌ها', 'سلام.md'), '# سلام'); await writeFile(path.join(root, 'image.png'), Buffer.from([1, 2])); await mkdir(path.join(root, '.knowledge-studio')); await writeFile(path.join(root, '.knowledge-studio', 'index.db'), 'private');
    const report = await enumeratePortableFolder(root); expect(report.entries.map((entry) => entry.relativePath)).toEqual(['image.png', 'یادداشت‌ها/سلام.md']); expect(report.skipped).toContain('.knowledge-studio'); await rm(root, { recursive: true, force: true });
  });
  it('exports without overwriting existing files by default', async () => { const source = await folder(); const destination = await folder(); await writeFile(path.join(source, 'a.md'), 'source'); await writeFile(path.join(destination, 'a.md'), 'existing'); await expect(exportFolder(source, destination)).rejects.toThrow(); expect(await readFile(path.join(destination, 'a.md'), 'utf8')).toBe('existing'); await rm(source, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }); });
  it('imports non-destructively and preserves binary bytes', async () => { const source = await folder(); const destination = await folder(); await writeFile(path.join(source, 'x.bin'), Buffer.from([0, 255, 3])); const report = await importFolder(source, destination); expect(report.entries).toHaveLength(1); expect(await readFile(path.join(destination, 'x.bin'))).toEqual(Buffer.from([0, 255, 3])); await rm(source, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }); });
  it('round-trips UTF-8 Persian text', async () => { const root = await folder(); const file = path.join(root, 'یادداشت.md'); await writeUtf8(file, 'متن فارسی و mixed English'); expect(await readUtf8(file)).toBe('متن فارسی و mixed English'); await rm(root, { recursive: true, force: true }); });
});
