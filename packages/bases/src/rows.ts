import { readMetadata, writeMetadata, type MetadataIssue } from '@knowledge-studio/metadata';
import { err, type Result } from '@knowledge-studio/shared';
import { walkVault, type Vault } from '@knowledge-studio/vault';
import type { BaseInput, BaseRow } from './index.js';
import type { FieldValue } from './validate.js';

const COLLECT_CONCURRENCY = 32;

/** Collects every Markdown note in the vault as Base query input (content + mtime). */
export async function collectBaseInputs(
  vault: Vault,
  folder?: string,
): Promise<readonly BaseInput[]> {
  const entries = await walkVault(vault.root);
  if (!entries.ok) return [];
  const paths = entries.value
    .filter(
      (entry) =>
        entry.kind === 'note' &&
        (!folder || entry.path === folder || entry.path.startsWith(`${folder}/`)),
    )
    .map((entry) => entry.path);
  const inputs: (BaseInput | null)[] = new Array<BaseInput | null>(paths.length).fill(null);
  let next = 0;
  // Bounded parallel reads keep large vaults responsive without exhausting file handles.
  const worker = async (): Promise<void> => {
    while (next < paths.length) {
      const index = next++;
      const read = await vault.readFile(paths[index]!);
      if (read.ok)
        inputs[index] = {
          path: paths[index]!,
          content: read.value.content,
          mtimeMs: read.value.mtimeMs,
        };
    }
  };
  await Promise.all(Array.from({ length: Math.min(COLLECT_CONCURRENCY, paths.length) }, worker));
  return inputs.filter((input): input is BaseInput => input !== null);
}

/**
 * Applies one inline Base edit through the canonical metadata writer so the
 * note body is preserved byte-for-byte and unknown properties survive.
 * Empty values remove the property.
 */
export function applyFieldEdit(
  content: string,
  key: string,
  value: FieldValue,
): Result<string, MetadataIssue[]> {
  const { data, issues } = readMetadata(content);
  if (issues.some((issue) => issue.key === '')) return err([...issues]);
  const patch: Record<string, unknown> = { ...data };
  const list: string[] | null = typeof value === 'object' && value !== null ? [...value] : null;
  const empty = value === null || value === '' || (list !== null && list.length === 0);
  if (empty) delete patch[key];
  else if (key === 'tags' || key === 'aliases')
    patch[key] =
      list ??
      String(value)
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
  else if (key === 'confidence') {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return err([{ key, message: 'confidence must be a number' }]);
    patch[key] = numeric;
  } else patch[key] = list ?? value;
  return writeMetadata(content, patch);
}

export type CellValue = string | number | boolean | null | readonly string[];
export interface BaseRowView {
  readonly path: string;
  readonly title: string;
  readonly documentId: string | null;
  readonly mtimeMs: number;
  readonly values: Readonly<Record<string, CellValue>>;
}

function cell(value: unknown): CellValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (Array.isArray(value))
    return value.map((item) =>
      typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
        ? String(item)
        : JSON.stringify(item),
    );
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** Projects a query row to only the requested fields — note bodies never leave the host. */
export function toRowView(row: BaseRow, fields: readonly string[]): BaseRowView {
  const values: Record<string, CellValue> = {};
  for (const key of fields)
    values[key] =
      key === 'title'
        ? row.title
        : key === 'path'
          ? row.path
          : key === 'modified'
            ? (row.modifiedAt ?? null)
            : cell(row.metadata[key]);
  const id = row.metadata['id'];
  return {
    path: row.path,
    title: row.title,
    documentId: typeof id === 'string' ? id : null,
    mtimeMs: row.modifiedAt ?? 0,
    values,
  };
}
