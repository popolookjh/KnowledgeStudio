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
  loadWorkspace: 'workspace:load',
  saveWorkspace: 'workspace:save',
  readCanvas: 'canvas:read',
  writeCanvas: 'canvas:write',
  historyList: 'history:list',
  historyRead: 'history:read',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitCommitSelected: 'git:commit-selected',
  mcpStatus: 'mcp:status',
  mcpStart: 'mcp:start',
  mcpStop: 'mcp:stop',
  pluginList: 'plugin:list',
  pluginSetEnabled: 'plugin:set-enabled',
  pluginApproveHighRisk: 'plugin:approve-high-risk',
  aiConfigList: 'ai-config:list',
  aiConfigUpsert: 'ai-config:upsert',
  aiConfigSetSecret: 'ai-config:set-secret',
  aiConfigRemoveSecret: 'ai-config:remove-secret',
  attachmentPick: 'attachment:pick',
  attachmentIssues: 'attachment:issues',
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

export interface AttachmentDto {
  readonly vaultPath: string;
  readonly markdownLink: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface AttachmentIssueDto {
  readonly vaultPath: string;
  readonly reason: 'missing' | 'orphan';
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

export interface RevisionDto {
  readonly id: string;
  readonly notePath: string;
  readonly createdAt: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface AiProviderConfigDto {
  readonly id: string;
  readonly displayName: string;
  readonly kind: 'local' | 'external';
  readonly endpoint?: string;
  readonly model?: string;
  readonly enabled: boolean;
  readonly semanticSearchEnabled: boolean;
  readonly sendsVaultContent: boolean;
  readonly disclosureConfirmed: boolean;
  readonly hasSecret: boolean;
}

export interface AiConfigStatusDto {
  readonly providers: readonly AiProviderConfigDto[];
  readonly secureStorageAvailable: boolean;
}

export interface PluginDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly requestedPermissions: readonly string[];
  readonly trusted: boolean;
  readonly enabled: boolean;
  readonly approvedHighRisk: readonly string[];
  readonly reason?: string;
  readonly runtime: 'deferred';
}

export interface McpStatusDto {
  readonly running: boolean;
  readonly endpoint: string | null;
  readonly vaultId: string | null;
  readonly tools: readonly string[];
  readonly lastError: string | null;
  readonly readOnly: true;
}

export interface GitStatusEntryDto {
  readonly path: string;
  readonly index: string;
  readonly worktree: string;
}

export interface GitStatusDto {
  readonly available: boolean;
  readonly branch: string | null;
  readonly entries: readonly GitStatusEntryDto[];
  readonly error?: string;
}

export interface GitDiffDto {
  readonly text: string;
  readonly paths: readonly string[];
}

export interface WorkspaceStateDto {
  readonly selectedVault: string | null;
  readonly openTabs: readonly string[];
  readonly activePath: string | null;
  readonly editorMode: 'edit' | 'split' | 'preview';
  readonly explorerWidth: number;
  readonly rightbarWidth: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
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
  loadWorkspace(): Promise<RpcResult<WorkspaceStateDto>>;
  saveWorkspace(state: WorkspaceStateDto): Promise<RpcResult<true>>;
  readCanvas(path: string): Promise<RpcResult<string>>;
  writeCanvas(path: string, content: string): Promise<RpcResult<true>>;
  listHistory(notePath: string): Promise<RpcResult<readonly RevisionDto[]>>;
  readHistory(notePath: string, revisionId: string): Promise<RpcResult<string>>;
  gitStatus(): Promise<RpcResult<GitStatusDto>>;
  gitDiff(paths: readonly string[]): Promise<RpcResult<GitDiffDto>>;
  gitCommitSelected(paths: readonly string[], message: string): Promise<RpcResult<{ hash: string }>>;
  mcpStatus(): Promise<RpcResult<McpStatusDto>>;
  mcpStart(port?: number): Promise<RpcResult<McpStatusDto>>;
  mcpStop(): Promise<RpcResult<McpStatusDto>>;
  listPlugins(): Promise<RpcResult<readonly PluginDto[]>>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<RpcResult<readonly PluginDto[]>>;
  approvePluginHighRisk(pluginId: string, permission: 'PROCESS_EXECUTE' | 'SECRETS', approved: boolean): Promise<RpcResult<readonly PluginDto[]>>;
  aiConfigList(): Promise<RpcResult<AiConfigStatusDto>>;
  aiConfigUpsert(config: Omit<AiProviderConfigDto, 'hasSecret'>): Promise<RpcResult<AiProviderConfigDto>>;
  aiConfigSetSecret(providerId: string, secret: string): Promise<RpcResult<AiProviderConfigDto>>;
  aiConfigRemoveSecret(providerId: string): Promise<RpcResult<AiProviderConfigDto>>;
  pickAttachment(notePath: string): Promise<RpcResult<AttachmentDto> | null>;
  attachmentIssues(notePath: string): Promise<RpcResult<readonly AttachmentIssueDto[]>>;
}

/** Filename suggestion helper shared by tab and explorer code. */
export function noteTitleFromPath(vaultPath: string): string {
  const basename = vaultPath.split('/').pop() ?? vaultPath;
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(0, dot) : basename;
}
