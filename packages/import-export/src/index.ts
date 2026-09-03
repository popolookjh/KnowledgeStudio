import fs from 'node:fs/promises';
import path from 'node:path';

/** Portable, non-destructive Markdown folder import/export. */
export interface TransferEntry { readonly relativePath: string; readonly bytes: number; }
export interface TransferReport { readonly entries: readonly TransferEntry[]; readonly skipped: readonly string[]; }

const RESERVED = new Set(['.knowledge-studio', '.git']);

function safeRelative(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join('/');
  return normalized.length > 0 && !normalized.startsWith('/') && !normalized.split('/').includes('..') && !RESERVED.has(normalized.split('/')[0] ?? '');
}

/** Enumerates portable Markdown and attachment files without modifying input. */
export async function enumeratePortableFolder(root: string): Promise<TransferReport> {
  const entries: TransferEntry[] = []; const skipped: string[] = [];
  async function visit(directory: string, relative: string): Promise<void> {
    const dirents = await fs.readdir(directory, { withFileTypes: true });
    for (const dirent of dirents) {
      const child = relative ? `${relative}/${dirent.name}` : dirent.name;
      if (RESERVED.has(dirent.name) && !relative) { skipped.push(child); continue; }
      if (!safeRelative(child)) { skipped.push(child); continue; }
      const absolute = path.join(directory, dirent.name);
      if (dirent.isDirectory()) await visit(absolute, child);
      else if (dirent.isFile()) entries.push({ relativePath: child, bytes: (await fs.stat(absolute)).size });
      else skipped.push(child);
    }
  }
  await visit(root, '');
  return { entries: entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath)), skipped };
}

/** Copies portable files into a destination, refusing overwrite by default. */
export async function exportFolder(sourceRoot: string, destinationRoot: string, overwrite = false): Promise<TransferReport> {
  const report = await enumeratePortableFolder(sourceRoot);
  for (const entry of report.entries) {
    const source = path.join(sourceRoot, ...entry.relativePath.split('/'));
    const destination = path.join(destinationRoot, ...entry.relativePath.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination, overwrite ? 0 : 1);
  }
  return report;
}

/** Imports a folder into a destination without deleting or overwriting files. */
export async function importFolder(sourceRoot: string, destinationRoot: string): Promise<TransferReport> {
  return exportFolder(sourceRoot, destinationRoot, false);
}

/** UTF-8 text round-trip helpers used by import/export callers. */
export async function readUtf8(filePath: string): Promise<string> { return fs.readFile(filePath, 'utf8'); }
export async function writeUtf8(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}
