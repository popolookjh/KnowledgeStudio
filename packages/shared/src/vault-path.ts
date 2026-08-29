import { StudioError } from './errors.js';
import { err, ok, type Result } from './result.js';

/**
 * Vault path algebra.
 *
 * A *vault path* is a vault-relative, forward-slash-separated path to a note
 * or attachment, e.g. `notes/projects/alpha.md`. Vault paths are the only
 * path representation used above the filesystem layer; absolute filesystem
 * paths never leave the vault engine.
 *
 * Validation is intentionally strict and cross-platform: a vault must be
 * portable between Windows, macOS and Linux, so anything Windows would
 * silently reinterpret (backslashes, drive letters, reserved device names,
 * trailing dots/spaces) is rejected up front. Unicode — including Persian —
 * is fully supported.
 */

export type VaultPathInvalidReason =
  | 'empty'
  | 'absolute'
  | 'unc'
  | 'drive-letter'
  | 'traversal'
  | 'invalid-separator'
  | 'invalid-character'
  | 'reserved-name'
  | 'trailing-dot-or-space'
  | 'segment-too-long'
  | 'path-too-long';

export class VaultPathError extends StudioError {
  readonly reason: VaultPathInvalidReason;
  readonly rawPath: string;

  constructor(reason: VaultPathInvalidReason, rawPath: string, detail?: string) {
    super('VAULT_PATH_INVALID', detail ? `Invalid vault path: ${detail}` : 'Invalid vault path', {
      details: { reason, rawPath },
    });
    this.reason = reason;
    this.rawPath = rawPath;
  }
}

/**
 * Maximum length of a canonical vault path, in UTF-16 code units.
 * Generous on purpose: real filesystem limits are per-component and
 * byte-based; this cap exists to reject pathological input early.
 */
export const MAX_VAULT_PATH_LENGTH = 1024;

/** Maximum length of a single path segment, in UTF-16 code units. */
export const MAX_VAULT_SEGMENT_LENGTH = 255;

/**
 * Windows reserves these device names in any casing, with or without an
 * extension. `COM10`+ and `LPT10`+ are NOT reserved and remain allowed.
 */
const WINDOWS_RESERVED_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Characters Windows forbids in file names; also ambiguous in links/URLs. */
const WINDOWS_FORBIDDEN_CHARS = /[<>:"|?*]/;

/** C0 control characters, DEL, and C1 control characters. */
// eslint-disable-next-line no-control-regex -- rejecting control characters is this regex's entire job
const CONTROL_CHARS = /[\u0000-\u001f\u007f\u0080-\u009f]/;

/** A segment that is exactly a drive reference, e.g. `C:` or `z:`. */
const DRIVE_SEGMENT_PATTERN = /^[A-Za-z]:$/;

export function vaultPathErrorDetail(reason: VaultPathInvalidReason): string {
  switch (reason) {
    case 'empty':
      return 'path is empty';
    case 'absolute':
      return 'absolute paths are not allowed inside the vault';
    case 'unc':
      return 'network (UNC) paths are not allowed inside the vault';
    case 'drive-letter':
      return 'drive letters are not allowed inside the vault';
    case 'traversal':
      return '".." segments that escape the vault are not allowed';
    case 'invalid-separator':
      return 'backslash is not a valid separator; use "/"';
    case 'invalid-character':
      return 'contains a character that is not allowed in file names';
    case 'reserved-name':
      return 'uses a reserved device name (e.g. CON, NUL, COM1)';
    case 'trailing-dot-or-space':
      return 'segments must not end with a dot or a space';
    case 'segment-too-long':
      return 'a path segment exceeds the maximum length';
    case 'path-too-long':
      return 'path exceeds the maximum total length';
  }
}

/**
 * Normalizes raw user input into a canonical vault path.
 *
 * Canonical form: no leading/trailing slashes, no empty or `.` segments,
 * single forward slashes. `..` segments, absolute forms, backslashes,
 * reserved names and Windows-forbidden characters are rejected rather than
 * silently rewritten, so the caller can surface a precise error.
 */
export function normalizeVaultPath(raw: string): Result<string, VaultPathError> {
  const fail = (reason: VaultPathInvalidReason, detail?: string): Result<string, VaultPathError> =>
    err(new VaultPathError(reason, raw, detail ?? vaultPathErrorDetail(reason)));

  if (raw.length === 0) {
    return fail('empty');
  }
  if (raw.startsWith('//')) {
    return fail('unc');
  }
  if (raw.startsWith('/')) {
    return fail('absolute');
  }
  if (raw.includes('\\')) {
    return fail('invalid-separator');
  }
  if (CONTROL_CHARS.test(raw)) {
    return fail('invalid-character');
  }

  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return fail('traversal');
    }
    if (segment.length > MAX_VAULT_SEGMENT_LENGTH) {
      return fail('segment-too-long');
    }
    if (DRIVE_SEGMENT_PATTERN.test(segment)) {
      return fail('drive-letter');
    }
    if (WINDOWS_FORBIDDEN_CHARS.test(segment)) {
      return fail('invalid-character');
    }
    // Windows reserves device names by the portion before the FIRST dot,
    // so `con.md` and even `con.backup.md` are unusable on Windows.
    const firstDot = segment.indexOf('.');
    const reservedStem = firstDot <= 0 ? segment : segment.slice(0, firstDot);
    if (WINDOWS_RESERVED_PATTERN.test(reservedStem)) {
      return fail('reserved-name');
    }
    if (/[. ]$/.test(segment)) {
      return fail('trailing-dot-or-space');
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return fail('empty');
  }

  const normalized = segments.join('/');
  if (normalized.length > MAX_VAULT_PATH_LENGTH) {
    return fail('path-too-long');
  }
  return ok(normalized);
}

/** True when `raw` is a valid vault path (canonical or not). */
export function isValidVaultPath(raw: string): boolean {
  return normalizeVaultPath(raw).ok;
}

/**
 * Joins a canonical base path (possibly `''` for the vault root) with one or
 * more relative parts. Every part is validated with the same rules as
 * {@link normalizeVaultPath}, so traversal cannot sneak in through inputs.
 */
export function joinVaultPath(
  base: string,
  ...parts: readonly string[]
): Result<string, VaultPathError> {
  const segments: string[] = [];
  const inputs = base.length > 0 ? [base, ...parts] : parts;
  for (const input of inputs) {
    const normalized = normalizeVaultPath(input);
    if (!normalized.ok) {
      return normalized;
    }
    segments.push(normalized.value);
  }
  const joined = segments.join('/');
  if (joined.length > MAX_VAULT_PATH_LENGTH) {
    return err(new VaultPathError('path-too-long', joined, vaultPathErrorDetail('path-too-long')));
  }
  return ok(joined);
}

/**
 * The following accessors operate on canonical vault paths (the output of
 * {@link normalizeVaultPath}); their behavior on non-canonical input is
 * deliberately unspecified.
 */

/** Final segment: `notes/idea.md` -> `idea.md`. */
export function getVaultBasename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** Everything before the final segment: `notes/idea.md` -> `notes`, `idea.md` -> `''`. */
export function getVaultDirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * Lowercased extension without the dot: `a.MD` -> `md`, `archive.tar.gz` ->
 * `gz`, `.gitignore` -> `''` (leading dot = hidden file, not extension).
 */
export function getVaultExtension(path: string): string {
  const basename = getVaultBasename(path);
  const dotIndex = basename.lastIndexOf('.');
  return dotIndex <= 0 ? '' : basename.slice(dotIndex + 1).toLowerCase();
}

/** Basename without its extension: `notes/idea.md` -> `idea`. */
export function getVaultStem(path: string): string {
  const basename = getVaultBasename(path);
  const dotIndex = basename.lastIndexOf('.');
  return dotIndex <= 0 ? basename : basename.slice(0, dotIndex);
}

/** True for Markdown notes (the only indexable content type). */
export function isMarkdownPath(path: string): boolean {
  return getVaultExtension(path) === 'md';
}
