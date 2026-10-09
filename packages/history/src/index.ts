import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Local revision history independent of Git. Stores snapshots as plain UTF-8 files. */
export interface Revision {
  readonly id: string;
  readonly notePath: string;
  readonly createdAt: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface DiffLine {
  readonly kind: 'same' | 'added' | 'removed';
  readonly text: string;
  readonly line: number;
}

export class RevisionStore {
  constructor(
    private readonly historyRoot: string,
    private readonly retention = 100,
  ) {}

  async record(notePath: string, content: string, now = new Date()): Promise<Revision> {
    const digest = createHash('sha256').update(content).digest('hex');
    const id = `${now.toISOString().replace(/[:.]/g, '-')}-${digest.slice(0, 12)}`;
    const dir = path.join(this.historyRoot, encodeURIComponent(notePath));
    await fs.mkdir(dir, { recursive: true });
    const revision: Revision = {
      id,
      notePath,
      createdAt: now.toISOString(),
      bytes: Buffer.byteLength(content),
      sha256: digest,
    };
    await fs.writeFile(path.join(dir, `${id}.md`), content, 'utf8');
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      `${JSON.stringify(revision, null, 2)}\n`,
      'utf8',
    );
    await this.prune(notePath);
    return revision;
  }

  async list(notePath: string): Promise<readonly Revision[]> {
    const dir = path.join(this.historyRoot, encodeURIComponent(notePath));
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const revisions: Revision[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      try {
        revisions.push(
          JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf8')) as Revision,
        );
      } catch {
        /* skip corrupt metadata */
      }
    }
    return revisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async read(notePath: string, revisionId: string): Promise<string | null> {
    const file = path.join(this.historyRoot, encodeURIComponent(notePath), `${revisionId}.md`);
    return fs.readFile(file, 'utf8').catch(() => null);
  }

  async restore(notePath: string, revisionId: string): Promise<string | null> {
    return this.read(notePath, revisionId);
  }

  async prune(notePath: string): Promise<void> {
    const revisions = await this.list(notePath);
    for (const old of revisions.slice(this.retention)) {
      const dir = path.join(this.historyRoot, encodeURIComponent(notePath));
      await fs.rm(path.join(dir, `${old.id}.md`), { force: true });
      await fs.rm(path.join(dir, `${old.id}.json`), { force: true });
    }
  }
}

/** Small line-oriented diff suitable for a revision preview. */
export function diffText(before: string, after: string): readonly DiffLine[] {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  const result: DiffLine[] = [];
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === b && a !== undefined) result.push({ kind: 'same', text: a, line: i + 1 });
    else {
      if (a !== undefined) result.push({ kind: 'removed', text: a, line: i + 1 });
      if (b !== undefined) result.push({ kind: 'added', text: b, line: i + 1 });
    }
  }
  return result;
}
