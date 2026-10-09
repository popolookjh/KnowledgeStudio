import { extractMarkdownLinks, extractWikiLinks, stripCodeSpans } from './parse.js';
import type { MarkdownLinkToken, WikiLinkToken } from './parse.js';

/**
 * Backlink index: an in-memory, rebuildable map of vault paths to the notes
 * that reference them. This mirrors the SQLite index (ADR-0003/0005) and is
 * the single algorithm both the UI backlinks panel and the future DB layer
 * share. No persistence here — persistence lands with the indexer package.
 */

export interface LinkReference {
  /** Note containing the link. */
  readonly source: string;
  /** Vault path the link points at (resolved). */
  readonly target: string;
  /** Display text (alias or target). */
  readonly display: string;
  /** 1-based line of the link. */
  readonly line: number;
  /** Heading anchor within the target, if any. */
  readonly heading: string | null;
  readonly kind: 'wiki' | 'markdown';
}

/** Per-note outgoing links. */
export interface OutgoingLinks {
  readonly wiki: readonly WikiLinkToken[];
  readonly markdown: readonly MarkdownLinkToken[];
}

/**
 * Scans a note body (frontmatter already stripped by the caller) and
 * returns all outgoing link tokens, ignoring occurrences inside code.
 */
export function extractOutgoingLinks(content: string): OutgoingLinks {
  const stripped = stripCodeSpans(content);
  return {
    wiki: extractWikiLinks(stripped),
    markdown: extractMarkdownLinks(stripped),
  };
}

/** Mutable accumulator used while (re)building the index. */
export class BacklinkIndex {
  /** path → references pointing at it */
  private readonly incoming = new Map<string, LinkReference[]>();
  /** path → outgoing snapshot */
  private readonly outgoing = new Map<string, OutgoingLinks>();

  /** Replaces the index contribution of one note (incremental update). */
  update(
    sourcePath: string,
    resolvedTargets: readonly LinkReference[],
    outgoing: OutgoingLinks,
  ): void {
    this.removeContributions(sourcePath);
    this.outgoing.set(sourcePath, outgoing);
    for (const reference of resolvedTargets) {
      const list = this.incoming.get(reference.target) ?? [];
      list.push(reference);
      this.incoming.set(reference.target, list);
    }
  }

  /** Drops a note from the index entirely (file deleted). */
  remove(sourcePath: string): void {
    this.removeContributions(sourcePath);
    this.outgoing.delete(sourcePath);
  }

  /** Clears the index (full rebuild). */
  clear(): void {
    this.incoming.clear();
    this.outgoing.clear();
  }

  private removeContributions(sourcePath: string): void {
    for (const [target, references] of this.incoming) {
      const filtered = references.filter((reference) => reference.source !== sourcePath);
      if (filtered.length === 0) {
        this.incoming.delete(target);
      } else {
        this.incoming.set(target, filtered);
      }
    }
  }

  /** All notes linking TO the given path, sorted by source path. */
  backlinksOf(vaultPath: string): readonly LinkReference[] {
    const references = this.incoming.get(vaultPath) ?? [];
    return [...references].sort((a, b) => a.source.localeCompare(b.source, 'en'));
  }

  /** Everything the given note links to. */
  outgoingOf(vaultPath: string): OutgoingLinks {
    return this.outgoing.get(vaultPath) ?? { wiki: [], markdown: [] };
  }

  /** Paths never referenced by any note (used by graph/unresolved views). */
  unreferencedPaths(): readonly string[] {
    return [...this.outgoing.keys()].filter((path) => !this.incoming.has(path));
  }

  snapshotSize(): { incomingEntries: number; outgoingEntries: number } {
    return { incomingEntries: this.incoming.size, outgoingEntries: this.outgoing.size };
  }
}
