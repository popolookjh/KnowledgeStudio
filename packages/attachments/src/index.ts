import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeVaultPath, getVaultDirname, getVaultBasename, ok, err, type Result } from '@knowledge-studio/shared';

/**
 * Attachment utilities. Source files are copied into a configured vault
 * directory; no external absolute path is ever returned to the renderer.
 */

export interface CopyAttachmentOptions {
  readonly vaultRoot: string;
  readonly sourcePath: string;
  readonly attachmentDir?: string;
  readonly notePath?: string;
}

export interface CopiedAttachment {
  readonly vaultPath: string;
  readonly markdownLink: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface AttachmentIssue {
  readonly vaultPath: string;
  readonly reason: 'missing' | 'orphan';
}

const DEFAULT_ATTACHMENT_DIR = 'attachments';

/** Copies an external attachment into the vault with a collision-safe name. */
export async function copyAttachment(options: CopyAttachmentOptions): Promise<Result<CopiedAttachment, Error>> {
  const attachmentDir = options.attachmentDir ?? DEFAULT_ATTACHMENT_DIR;
  const sourceStat = await fs.stat(options.sourcePath).catch(() => null);
  if (!sourceStat?.isFile()) {
    return err(new Error('Attachment source does not exist or is not a file'));
  }
  const sourceName = path.basename(options.sourcePath);
  const normalized = normalizeVaultPath(`${attachmentDir}/${sourceName}`);
  if (!normalized.ok) {
    return err(normalized.error);
  }
  const destination = path.join(options.vaultRoot, ...normalized.value.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  let vaultPath = normalized.value;
  const sourceBytes = await fs.readFile(options.sourcePath);
  const hash = createHash('sha256').update(sourceBytes).digest('hex');
  let suffix = 2;
  while (await fileExists(destinationFor(options.vaultRoot, vaultPath))) {
    const extension = path.extname(sourceName);
    const stem = path.basename(sourceName, extension);
    const candidate = normalizeVaultPath(`${attachmentDir}/${stem}-${suffix}${extension}`);
    if (!candidate.ok) return err(candidate.error);
    vaultPath = candidate.value;
    suffix += 1;
  }
  await fs.writeFile(destinationFor(options.vaultRoot, vaultPath), sourceBytes, { flag: 'wx' });
  const noteDir = options.notePath ? getVaultDirname(options.notePath) : '';
  const relative = path.posix.relative(noteDir, vaultPath) || getVaultBasename(vaultPath);
  return ok({ vaultPath, markdownLink: `![](${relative})`, bytes: sourceBytes.length, sha256: hash });
}

/** Returns attachment paths referenced by Markdown image/link syntax. */
export function referencedAttachments(markdown: string): readonly string[] {
  const result: string[] = [];
  const pattern = /!?(?:\[[^\]]*\])\(([^)\s]+)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const href = match[1] ?? '';
    if (!/^(?:https?:|data:|mailto:)/i.test(href)) {
      result.push(href.split('#')[0] ?? href);
    }
  }
  return [...new Set(result)];
}

/** Finds referenced attachments whose files no longer exist. */
export async function findMissingAttachments(
  vaultRoot: string,
  notePath: string,
  markdown: string,
): Promise<readonly AttachmentIssue[]> {
  const issues: AttachmentIssue[] = [];
  const noteDir = getVaultDirname(notePath);
  for (const reference of referencedAttachments(markdown)) {
    const normalized = normalizeVaultPath(path.posix.normalize(path.posix.join(noteDir, reference)));
    if (!normalized.ok || !(await fileExists(destinationFor(vaultRoot, normalized.value)))) {
      issues.push({ vaultPath: reference, reason: 'missing' });
    }
  }
  return issues;
}

/** Finds files in the attachment directory not referenced by any note. */
export async function findOrphanAttachments(
  vaultRoot: string,
  noteContents: readonly { path: string; content: string }[],
  attachmentDir = DEFAULT_ATTACHMENT_DIR,
): Promise<readonly AttachmentIssue[]> {
  const referenced = new Set<string>();
  for (const note of noteContents) {
    for (const reference of referencedAttachments(note.content)) {
      const noteDir = getVaultDirname(note.path);
      const normalized = normalizeVaultPath(path.posix.normalize(path.posix.join(noteDir, reference)));
      if (normalized.ok) referenced.add(normalized.value);
    }
  }
  const issues: AttachmentIssue[] = [];
  const walk = async (dir: string, relative: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), child);
      else if (entry.isFile() && !referenced.has(child)) issues.push({ vaultPath: child, reason: 'orphan' });
    }
  };
  await walk(path.join(vaultRoot, attachmentDir), attachmentDir);
  return issues;
}

function destinationFor(root: string, vaultPath: string): string {
  return path.join(root, ...vaultPath.split('/'));
}
async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}
