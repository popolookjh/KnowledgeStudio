import { err, getVaultStem, normalizeVaultPath, ok, type Result } from '@knowledge-studio/shared';
import type { WikiLinkToken } from './parse.js';

/**
 * Wiki link resolution.
 *
 * Resolution is location-independent: a link `[[Note]]` matches any note in
 * the vault whose stem (basename without extension) equals `Note`,
 * case-insensitively per the host filesystem convention. When several notes
 * share a stem the link is `ambiguous` and the UI asks the user to pick;
 * nothing is auto-disambiguated.
 */

export type LinkResolution =
  | { readonly status: 'resolved'; readonly vaultPath: string; readonly heading: string | null }
  | { readonly status: 'unresolved'; readonly target: string; readonly heading: string | null }
  | { readonly status: 'ambiguous'; readonly candidates: readonly string[]; readonly target: string };

export interface LinkIndexEntry {
  /** The note containing the link. */
  readonly sourcePath: string;
  readonly token: WikiLinkToken;
}

/** Case-insensitive stem → canonical paths map. */
export type StemMap = ReadonlyMap<string, readonly string[]>;

/** Builds the stem index used for resolution from a list of note paths. */
export function buildStemMap(notePaths: readonly string[]): StemMap {
  const map = new Map<string, string[]>();
  for (const notePath of notePaths) {
    const stem = getVaultStem(notePath);
    if (stem.length === 0) {
      continue;
    }
    const key = stem.toLowerCase();
    const list = map.get(key) ?? [];
    list.push(notePath);
    map.set(key, list);
  }
  return map;
}

/**
 * Resolves a single wiki link against the stem map. `notePaths` enables
 * exact-path resolution for folder-hinted targets (`[[folder/Note]]`) and
 * takes precedence over the stem match.
 */
export function resolveWikiLink(
  token: WikiLinkToken,
  stems: StemMap,
  notePaths: readonly string[] = [],
): LinkResolution {
  if (token.target.length === 0) {
    return { status: 'unresolved', target: token.raw, heading: token.heading };
  }
  const key = token.target.toLowerCase();
  // 1) Exact path match, with or without extension.
  const byPath = notePaths.find(
    (notePath) => notePath.toLowerCase() === key || notePath.toLowerCase() === `${key}.md`,
  );
  if (byPath !== undefined) {
    return { status: 'resolved', vaultPath: byPath, heading: token.heading };
  }
  // 2) Stem match (location-independent resolution).
  const candidates = stems.get(key) ?? [];
  if (candidates.length === 0) {
    return { status: 'unresolved', target: token.target, heading: token.heading };
  }
  if (candidates.length === 1) {
    return {
      status: 'resolved',
      vaultPath: candidates[0] ?? '',
      heading: token.heading,
    };
  }
  return { status: 'ambiguous', candidates, target: token.target };
}

/**
 * Creates the target path for an unresolved link, honoring any folder hint
 * present in the target text (e.g. `[[folder/Note]]`) and normalizing the
 * result through the shared path algebra.
 */
export function targetPathForUnresolved(rawTarget: string, heading: string | null): Result<string, Error> {
  const withExtension = rawTarget.includes('.') ? rawTarget : `${rawTarget}.md`;
  const normalized = normalizeVaultPath(withExtension);
  if (!normalized.ok) {
    return err(normalized.error);
  }
  void heading;
  return ok(normalized.value);
}
