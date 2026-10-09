import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyAttachment,
  findMissingAttachments,
  findOrphanAttachments,
  referencedAttachments,
} from '../src/index.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function vault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ks-att-'));
  dirs.push(dir);
  return dir;
}

describe('attachments', () => {
  it('copies bytes into attachments and returns a relative Markdown link', async () => {
    const root = await vault();
    const source = path.join(root, 'external.bin');
    await writeFile(source, Buffer.from([0, 1, 255]));
    const result = await copyAttachment({
      vaultRoot: root,
      sourcePath: source,
      notePath: 'notes/idea.md',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vaultPath).toBe('attachments/external.bin');
      expect(result.value.markdownLink).toBe('![](../attachments/external.bin)');
      expect(await readFile(path.join(root, result.value.vaultPath))).toEqual(
        Buffer.from([0, 1, 255]),
      );
    }
  });
  it('avoids filename collisions', async () => {
    const root = await vault();
    const source = path.join(root, 'img.png');
    await writeFile(source, 'x');
    const one = await copyAttachment({ vaultRoot: root, sourcePath: source });
    const two = await copyAttachment({ vaultRoot: root, sourcePath: source });
    expect(one.ok ? one.value.vaultPath : undefined).toBe('attachments/img.png');
    expect(two.ok ? two.value.vaultPath : undefined).toBe('attachments/img-2.png');
  });
  it('extracts local references and reports missing files', async () => {
    const root = await vault();
    expect(
      referencedAttachments('![a](attachments/a.png) [b](docs/b.pdf#page=1) [x](https://x)'),
    ).toEqual(['attachments/a.png', 'docs/b.pdf']);
    const issues = await findMissingAttachments(root, 'notes/n.md', '![a](../attachments/a.png)');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe('missing');
  });
  it('reports orphan files without deleting them', async () => {
    const root = await vault();
    await mkdir(path.join(root, 'attachments'), { recursive: true });
    await writeFile(path.join(root, 'attachments', 'used.png'), 'u');
    await writeFile(path.join(root, 'attachments', 'orphan.pdf'), 'o');
    const issues = await findOrphanAttachments(root, [
      { path: 'note.md', content: '![](attachments/used.png)' },
    ]);
    expect(issues).toEqual([{ vaultPath: 'attachments/orphan.pdf', reason: 'orphan' }]);
  });
});
