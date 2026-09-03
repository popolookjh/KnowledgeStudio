import { spawn } from 'node:child_process';

/**
 * Optional, explicitly-invoked Git integration. This layer intentionally
 * exposes only status, diff, and selected-file commit. There is no push,
 * reset, clean, rebase, force, or automatic destructive operation.
 */
export interface GitStatusEntry { readonly path: string; readonly index: string; readonly worktree: string; }
export interface GitStatus { readonly available: boolean; readonly branch: string | null; readonly entries: readonly GitStatusEntry[]; readonly error?: string; }
export interface GitDiff { readonly text: string; readonly paths: readonly string[]; }
export interface GitCommandOptions { readonly cwd: string; readonly timeoutMs?: number; }

const SAFE_COMMANDS = new Set(['status', 'diff', 'add', 'commit']);

export class GitClient {
  constructor(private readonly options: GitCommandOptions) {}

  async status(): Promise<GitStatus> {
    const branch = await this.run(['branch', '--show-current']);
    const raw = await this.run(['status', '--porcelain=v1']);
    if (!branch.ok) return { available: false, branch: null, entries: [], error: branch.error };
    if (!raw.ok) return { available: false, branch: null, entries: [], error: raw.error };
    const entries: GitStatusEntry[] = [];
    for (const line of raw.stdout.split(/\r?\n/).filter(Boolean)) {
      const index = line[0] ?? ' '; const worktree = line[1] ?? ' '; const path = line.slice(3).trim();
      entries.push({ index, worktree, path });
    }
    return { available: true, branch: branch.stdout.trim() || null, entries };
  }

  async diff(paths: readonly string[] = []): Promise<{ ok: true; value: GitDiff } | { ok: false; error: string }> {
    const result = await this.run(['diff', '--', ...paths]);
    return result.ok ? { ok: true, value: { text: result.stdout, paths } } : { ok: false, error: result.error };
  }

  /** Explicit selected-file commit. Caller must supply a non-empty message and paths. */
  async commitSelected(paths: readonly string[], message: string): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
    if (paths.length === 0) return { ok: false, error: 'Select at least one file to commit' };
    if (message.trim().length === 0) return { ok: false, error: 'Commit message cannot be empty' };
    const added = await this.run(['add', '--', ...paths]);
    if (!added.ok) return { ok: false, error: added.error };
    const committed = await this.run(['commit', '-m', message]);
    if (!committed.ok) return { ok: false, error: committed.error };
    const hash = await this.run(['rev-parse', '--short', 'HEAD']);
    return hash.ok ? { ok: true, hash: hash.stdout.trim() } : { ok: true, hash: 'unknown' };
  }

  private run(args: readonly string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
    const command = args[0];
    if (!command || !SAFE_COMMANDS.has(command) && command !== 'branch' && command !== 'rev-parse') return Promise.resolve({ ok: false, error: 'Git command is not permitted' });
    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd: this.options.cwd, shell: false, windowsHide: true });
      let stdout = ''; let stderr = ''; const timeout = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'Git command timed out' }); }, this.options.timeoutMs ?? 15000);
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.on('error', (error) => { clearTimeout(timeout); resolve({ ok: false, error: error.message }); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve({ ok: true, stdout });
        else resolve({ ok: false, error: stderr.trim() || `git exited with code ${code ?? 'unknown'}` });
      });
    });
  }
}
