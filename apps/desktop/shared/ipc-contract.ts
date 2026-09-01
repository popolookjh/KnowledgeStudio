/**
 * IPC contract between the Electron main process and the renderer.
 *
 * This module is imported by BOTH `electron/` (main + preload, CommonJS
 * output) and `src/` (renderer, ESM). It must therefore contain types and
 * pure data helpers only — no Node or DOM APIs.
 *
 * Serializable errors: vault failures cross the bridge as plain objects
 * (`RpcError`), never Error instances.
 */

export const IPC = {
  init: 'app:init',
  pickVault: 'vault:pick',
  createVault: 'vault:create',
  reopenVault: 'vault:reopen',
  closeVault: 'vault:close',
  listEntries: 'vault:list',
  readNote: 'vault:read',
  writeNote: 'vault:write',
  createNote: 'vault:create-note',
  renameEntry: 'vault:rename',
  deleteEntry: 'vault:delete',
  vaultEvent: 'vault:event',
  search: 'search:query',
  rebuildIndex: 'search:rebuild',
} as const;

export interface RpcError {
  readonly code: string;
  readonly message: string;
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError };

export interface InitInfo {
  readonly version: string;
  readonly platform: string;
}

export interface VaultSessionInfo {
  readonly rootPath: string;
}

export type EntryKind = 'note' | 'attachment' | 'file' | 'folder';

export interface EntryDto {
  readonly kind: EntryKind;
  readonly path: string;
  readonly name: string;
}

export interface ReadNoteResult {
  readonly content: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface WriteNoteResult {
  readonly mtimeMs: number;
}

export interface VaultEventDto {
  readonly kind: 'created' | 'changed' | 'deleted';
  readonly vaultPath: string;
}

export interface SearchHitDto {
  readonly path: string;
  readonly title: string;
  readonly snippet: string;
  readonly rank: number;
}

export interface IndexStatusDto {
  readonly indexedNotes: number;
}

/**
 * The complete surface the preload script exposes on `window.knowledgeStudio`.
 * Declared here so main, preload, and renderer share one source of truth.
 */
export interface BridgeApi {
  readonly version: string;
  readonly platform: string;
  init(): Promise<InitInfo>;
  pickVault(): Promise<RpcResult<VaultSessionInfo> | null>;
  createVault(): Promise<RpcResult<VaultSessionInfo> | null>;
  reopenVault(): Promise<RpcResult<VaultSessionInfo> | null>;
  closeVault(): Promise<void>;
  listEntries(): Promise<RpcResult<readonly EntryDto[]>>;
  readNote(vaultPath: string): Promise<RpcResult<ReadNoteResult>>;
  writeNote(
    vaultPath: string,
    content: string,
    expectedMtimeMs?: number,
  ): Promise<RpcResult<WriteNoteResult>>;
  createNote(vaultPath: string, content: string): Promise<RpcResult<string>>;
  renameEntry(from: string, to: string): Promise<RpcResult<string>>;
  deleteEntry(vaultPath: string): Promise<RpcResult<string>>;
  onVaultEvent(listener: (event: VaultEventDto) => void): () => void;
  search(query: string): Promise<RpcResult<readonly SearchHitDto[]>>;
  rebuildIndex(): Promise<RpcResult<IndexStatusDto>>;
}

/** Filename suggestion helper shared by tab and explorer code. */
export function noteTitleFromPath(vaultPath: string): string {
  const basename = vaultPath.split('/').pop() ?? vaultPath;
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(0, dot) : basename;
}
