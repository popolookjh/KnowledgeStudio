import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitClient } from '../src/index.js';

async function repo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ks-git-'));
  const run = async (args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const p = spawn('git', args, { cwd: dir });
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(String(code)))));
    });
  await run(['init', '-q']);
  await run(['config', 'user.email', 'test@example.com']);
  await run(['config', 'user.name', 'Test']);
  await writeFile(path.join(dir, 'note.md'), '# note');
  await run(['add', 'note.md']);
  await run(['commit', '-qm', 'initial']);
  return dir;
}

describe('GitClient', () => {
  it('reads status and branch without exposing destructive commands', async () => {
    const dir = await repo();
    const client = new GitClient({ cwd: dir });
    const status = await client.status();
    expect(status.available).toBe(true);
    expect(status.entries).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
  it('returns diffs for selected paths', async () => {
    const dir = await repo();
    await writeFile(path.join(dir, 'note.md'), '# changed');
    const result = await new GitClient({ cwd: dir }).diff(['note.md']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toContain('-# note');
    await rm(dir, { recursive: true, force: true });
  });
  it('validates selected commits', async () => {
    const dir = await repo();
    const client = new GitClient({ cwd: dir });
    expect((await client.commitSelected([], 'x')).ok).toBe(false);
    expect((await client.commitSelected(['note.md'], '')).ok).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
  it('commits selected files explicitly', async () => {
    const dir = await repo();
    await writeFile(path.join(dir, 'note.md'), '# changed');
    const result = await new GitClient({ cwd: dir }).commitSelected(['note.md'], 'update note');
    expect(result.ok).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
