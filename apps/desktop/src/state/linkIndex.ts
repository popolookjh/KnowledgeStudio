import {
  BacklinkIndex,
  buildStemMap,
  extractOutgoingLinks,
  resolveWikiLink,
  type LinkReference,
  type StemMap,
  type WikiLinkToken,
} from '@knowledge-studio/links';
import { splitFrontmatter } from '@knowledge-studio/markdown';

/**
 * Renderer-side link index (Phase 3): maintains wiki-link resolution and
 * backlinks over the whole vault. The full scan happens once per vault open
 * and then stays incremental via watcher events and editor changes; the
 * SQLite indexer (Phase 5) will take over persistence at scale.
 *
 * This service is observable so React panels re-render on index changes.
 */

export interface UnresolvedLink {
  readonly target: string;
  readonly heading: string | null;
  readonly line: number;
}

export interface LinkIndexSnapshot {
  readonly version: number;
}

class LinkIndexService {
  private index = new BacklinkIndex();
  private stems: StemMap = new Map();
  private paths: readonly string[] = [];
  private contents = new Map<string, string>();
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LinkIndexSnapshot => ({ version: this.version });

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Full rebuild from the current vault contents (open session). */
  async rebuild(
    notePaths: readonly string[],
    readNote: (vaultPath: string) => Promise<string | null>,
  ): Promise<void> {
    this.index.clear();
    this.contents.clear();
    for (const notePath of notePaths) {
      const content = await readNote(notePath);
      if (content !== null) {
        this.contents.set(notePath, content);
      }
    }
    this.paths = [...this.contents.keys()];
    this.stems = buildStemMap(this.paths);
    for (const [notePath, content] of this.contents) {
      this.indexNote(notePath, content);
    }
    this.emit();
  }

  /** Adds or replaces one note's contribution (created/edited). */
  updateNote(notePath: string, content: string): void {
    const isNew = !this.contents.has(notePath);
    this.contents.set(notePath, content);
    if (isNew) {
      this.paths = [...this.contents.keys()];
      this.stems = buildStemMap(this.paths);
    }
    this.indexNote(notePath, content);
    this.emit();
  }

  /** Drops a deleted note from the index. */
  removeNote(notePath: string): void {
    this.contents.delete(notePath);
    this.paths = [...this.contents.keys()];
    this.stems = buildStemMap(this.paths);
    this.index.remove(notePath);
    this.emit();
  }

  private indexNote(notePath: string, content: string): void {
    const body = splitFrontmatter(content).body;
    const outgoing = extractOutgoingLinks(body);
    const references: LinkReference[] = [];
    for (const token of outgoing.wiki) {
      const resolution = resolveWikiLink(token, this.stems, this.paths);
      if (resolution.status === 'resolved') {
        references.push({
          source: notePath,
          target: resolution.vaultPath,
          display: token.alias ?? token.target,
          line: token.line,
          heading: resolution.heading,
          kind: 'wiki',
        });
      }
    }
    for (const token of outgoing.markdown) {
      const href = token.href;
      if (!href.endsWith('.md') && !href.includes('.md#')) {
        continue;
      }
      const targetPath = href.split('#')[0] ?? '';
      const resolution = resolveWikiLink(
        { raw: href, target: targetPath, heading: null, alias: null, start: token.start, end: token.end, line: token.line },
        this.stems,
        this.paths,
      );
      if (resolution.status === 'resolved') {
        references.push({
          source: notePath,
          target: resolution.vaultPath,
          display: targetPath,
          line: token.line,
          heading: null,
          kind: 'markdown',
        });
      }
    }
    this.index.update(notePath, references, outgoing);
  }

  /** Notes linking TO this path (with display info for the panel). */
  backlinksOf(vaultPath: string): readonly LinkReference[] {
    return this.index.backlinksOf(vaultPath);
  }

  /** Unresolved wiki links of one note — candidates for note creation. */
  unresolvedOf(vaultPath: string): readonly UnresolvedLink[] {
    const content = this.contents.get(vaultPath);
    if (content === undefined) {
      return [];
    }
    const body = splitFrontmatter(content).body;
    const outgoing = extractOutgoingLinks(body);
    const unresolved: UnresolvedLink[] = [];
    const seen = new Set<string>();
    for (const token of outgoing.wiki) {
      const resolution = resolveWikiLink(token, this.stems, this.paths);
      if (resolution.status === 'unresolved' && token.target.length > 0) {
        const key = `${token.target}#${token.heading ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          unresolved.push({ target: token.target, heading: token.heading, line: token.line });
        }
      }
    }
    return unresolved;
  }

  wikiTokensOf(vaultPath: string): readonly WikiLinkToken[] {
    return this.index.outgoingOf(vaultPath).wiki;
  }
}

export const linkIndex = new LinkIndexService();
