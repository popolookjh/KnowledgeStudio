import { err, getVaultStem, ok, type Result } from '@knowledge-studio/shared';
import { readFrontmatter } from '@knowledge-studio/markdown';
import { DatabaseSync } from 'node:sqlite';

/**
 * Rebuildable SQLite FTS5 search index (ADR-0005).
 *
 * The database is a disposable cache: deleting the file and calling
 * `rebuild` restores identical behavior. Content fed here is derived from
 * the Markdown source of truth (note body + frontmatter fields); nothing
 * in the vault depends on this index existing.
 *
 * Tokenizer: unicode61 with diacritic folding — Persian and mixed-script
 * content tokenize on word boundaries without stemming.
 */

export interface SearchHit {
  readonly path: string;
  readonly title: string;
  /** Matched fragment of the body with «» markers, or '' for name-only hits. */
  readonly snippet: string;
  /** bm25 rank; lower is better. */
  readonly rank: number;
}

export type SearchField = 'path' | 'title' | 'body' | 'tags' | 'aliases';

export interface SearchOptions {
  readonly limit?: number;
  /** Restrict matching to these columns; default: all. */
  readonly fields?: readonly SearchField[];
}

export interface IndexedNoteInput {
  readonly path: string;
  readonly content: string;
}

const ALL_FIELDS: readonly SearchField[] = ['path', 'title', 'body', 'tags', 'aliases'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes_map (
  path TEXT PRIMARY KEY,
  fts_rowid INTEGER NOT NULL UNIQUE
);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path,
  title,
  body,
  tags,
  aliases,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export class SearchIndex {
  private db: DatabaseSync | null = null;
  private dbPath = '';

  /** Opens (creating if needed) the index database. */
  open(dbPath: string): Result<true, Error> {
    try {
      this.db = new DatabaseSync(dbPath);
      this.dbPath = dbPath;
      this.db.exec(SCHEMA);
      this.db.exec('PRAGMA journal_mode = WAL;');
      return ok(true);
    } catch (error) {
      this.db = null;
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  get path(): string {
    return this.dbPath;
  }

  /** Drops all indexed content (full rebuild step 1). */
  clear(): Result<true, Error> {
    if (!this.db) {
      return err(new Error('index is not open'));
    }
    try {
      this.db.exec('DELETE FROM notes_fts;');
      this.db.exec('DELETE FROM notes_map;');
      return ok(true);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Full rebuild: clears and re-indexes every note. Corruption recovery is
   * the same path — discard the file, rebuild from Markdown.
   */
  rebuild(notes: readonly IndexedNoteInput[]): Result<number, Error> {
    const cleared = this.clear();
    if (!cleared.ok) {
      return cleared;
    }
    let count = 0;
    for (const note of notes) {
      const upserted = this.upsert(note);
      if (!upserted.ok) {
        return upserted;
      }
      count += 1;
    }
    return ok(count);
  }

  /**
   * Adds or replaces one note. Frontmatter title/tags/aliases feed their
   * columns; the body (frontmatter stripped) feeds the body column.
   */
  upsert(note: IndexedNoteInput): Result<true, Error> {
    if (!this.db) {
      return err(new Error('index is not open'));
    }
    try {
      const parsed = readFrontmatter(note.content);
      const title =
        typeof parsed.data['title'] === 'string' ? parsed.data['title'] : getVaultStem(note.path);
      const tags = stringifyList(parsed.data['tags']);
      const aliases = stringifyList(parsed.data['aliases']);
      const existing = this.db
        .prepare('SELECT fts_rowid FROM notes_map WHERE path = ?')
        .get(note.path) as { fts_rowid: number } | undefined;
      if (existing) {
        this.db.prepare('DELETE FROM notes_fts WHERE rowid = ?').run(existing.fts_rowid);
      }
      const inserted = this.db
        .prepare('INSERT INTO notes_fts (path, title, body, tags, aliases) VALUES (?, ?, ?, ?, ?)')
        .run(note.path, title, parsed.body, tags, aliases);
      const rowid = Number(inserted.lastInsertRowid);
      if (existing) {
        this.db.prepare('UPDATE notes_map SET fts_rowid = ? WHERE path = ?').run(rowid, note.path);
      } else {
        this.db
          .prepare('INSERT INTO notes_map (path, fts_rowid) VALUES (?, ?)')
          .run(note.path, rowid);
      }
      return ok(true);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Removes a note from the index (file deleted). */
  remove(vaultPath: string): Result<true, Error> {
    if (!this.db) {
      return err(new Error('index is not open'));
    }
    try {
      const existing = this.db
        .prepare('SELECT fts_rowid FROM notes_map WHERE path = ?')
        .get(vaultPath) as { fts_rowid: number } | undefined;
      if (!existing) {
        return ok(true);
      }
      this.db.prepare('DELETE FROM notes_fts WHERE rowid = ?').run(existing.fts_rowid);
      this.db.prepare('DELETE FROM notes_map WHERE path = ?').run(vaultPath);
      return ok(true);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Prefix-matching search across the selected fields, ranked with bm25.
   * Tokens are ANDed; each token matches any prefix.
   */
  search(rawQuery: string, options?: SearchOptions): Result<readonly SearchHit[], Error> {
    if (!this.db) {
      return err(new Error('index is not open'));
    }
    const match = buildMatchExpression(rawQuery, options?.fields ?? ALL_FIELDS);
    if (match === null) {
      return ok([]);
    }
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
    try {
      const statement = this.db.prepare(`
        SELECT path, title,
               snippet(notes_fts, 2, '«', '»', '…', 12) AS snippet,
               rank
        FROM notes_fts
        WHERE notes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      const rows = statement.all(match, limit) as Array<{
        path: string;
        title: string;
        snippet: string;
        rank: number;
      }>;
      return ok(rows.map((row) => ({ ...row, rank: Number(row.rank) })));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Number of indexed notes. */
  size(): number {
    if (!this.db) {
      return 0;
    }
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM notes_map').get() as
      { count: number } | undefined;
    return row?.count ?? 0;
  }
}

/**
 * Builds a safe FTS5 match expression: each whitespace-separated token is
 * quoted (neutralizing FTS operators) and prefix-matched (`*`) against the
 * selected columns; tokens AND together. Returns null for empty input.
 */
export function buildMatchExpression(
  rawQuery: string,
  fields: readonly SearchField[] = ALL_FIELDS,
): string | null {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["*]/g, ''))
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  // Column-filtered queries in FTS5 need `col : token` per token; without
  // filters a plain quoted token list suffices.
  if (fields.length === ALL_FIELDS.length) {
    return tokens.map((token) => `"${token}"*`).join(' ');
  }
  return tokens
    .map((token) => `(${fields.map((field) => `${field} : "${token}"*`).join(' OR ')})`)
    .join(' ');
}

function stringifyList(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(' ');
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}
