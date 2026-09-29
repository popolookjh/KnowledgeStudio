import { app, dialog, ipcMain, safeStorage } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createVault,
  openVault,
  walkVault,
  type Vault,
  type VaultEntry,
} from '@knowledge-studio/vault';
import { copyAttachment, findMissingAttachments, findOrphanAttachments } from '@knowledge-studio/attachments';
import { SearchIndex } from '@knowledge-studio/search';
import { RevisionStore } from '@knowledge-studio/history';
import { GitClient } from '@knowledge-studio/git';
import { ActiveVaultMcpHost } from '@knowledge-studio/mcp-host';
import { LocalPluginHost } from '@knowledge-studio/plugin-host';
import { ElectronAiConfigHost } from './ai-config-host.js';
import { BasesHost } from './bases-host.js';
import { WebClipperHost } from './clipper-host.js';
import { PdfHost } from './pdf-host.js';
import { TrustedNoteWriter } from './trusted-note-writer.js';
import { createVaultMcpDataSource } from './mcp-vault-source.js';
import { IPC } from '../shared/ipc-contract.js';
import type {
  AiConfigStatusDto,
  AiProviderConfigDto,
  AttachmentDto,
  AttachmentIssueDto,
  ClipResultDto,
  PluginDto,
  McpStatusDto,
  GitDiffDto,
  GitStatusDto,
  EntryDto,
  InitInfo,
  ReadNoteResult,
  RevisionDto,
  RpcError,
  RpcResult,
  SearchHitDto,
  VaultEventDto,
  VaultSessionInfo,
  WorkspaceStateDto,
  WriteNoteResult,
} from '../shared/ipc-contract.js';

/**
 * Main-process vault host. Owns the single active vault session, exposes it
 * to the renderer over the IPC contract, and forwards watcher events.
 *
 * The renderer never sees an absolute filesystem path except the vault root
 * it explicitly chose; all content addressing stays vault-relative.
 */

interface SerializedFailure {
  code: string;
  message: string;
}

function serializeFailure(error: unknown): RpcError {
  const failure = error as Partial<SerializedFailure & Error>;
  if (typeof failure?.code === 'string' && typeof failure?.message === 'string') {
    return { code: failure.code, message: failure.message };
  }
  return { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
}

function rpc<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

function toEntryDto(entry: VaultEntry): EntryDto {
  return { kind: entry.kind, path: entry.path, name: entry.name };
}

class VaultHost {
  private vault: Vault | null = null;
  private watcherDisposer: { close(): void } | null = null;
  private renderer: BrowserWindow | null = null;
  private searchIndex = new SearchIndex();
  private history: RevisionStore | null = null;
  private writer: TrustedNoteWriter | null = null;
  private bases: BasesHost | null = null;
  private clipper: WebClipperHost | null = null;
  private pdf: PdfHost | null = null;
  private readonly mcpHost = new ActiveVaultMcpHost();
  private readonly pluginHost = new LocalPluginHost(
    path.join(app.getPath('userData'), 'plugins'),
    path.join(app.getPath('userData'), 'plugin-policy'),
  );
  private readonly aiConfigHost = new ElectronAiConfigHost(app.getPath('userData'), safeStorage);

  bindWindow(win: BrowserWindow): void {
    this.renderer = win;
  }

  async lastVaultPath(): Promise<string | null> {
    try {
      const raw = await fs.readFile(this.settingsPath(), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && 'lastVaultPath' in parsed) {
        const value = (parsed as Record<string, unknown>)['lastVaultPath'];
        return typeof value === 'string' ? value : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private settingsPath(): string {
    return path.join(app.getPath('userData'), 'knowledge-studio.json');
  }

  private async rememberVault(rootPath: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.settingsPath()), { recursive: true });
      await fs.writeFile(this.settingsPath(), JSON.stringify({ lastVaultPath: rootPath }, null, 2));
    } catch {
      // Settings persistence is best-effort; the app works without it.
    }
  }

  private async adoptVault(vault: Vault): Promise<VaultSessionInfo> {
    await this.closeInternal();
    this.vault = vault;
    this.history = new RevisionStore(path.join(vault.appDir, 'history'));
    this.writer = new TrustedNoteWriter(vault, this.history);
    this.bases = new BasesHost(this.writer);
    this.clipper = new WebClipperHost(this.writer);
    this.pdf = new PdfHost(this.writer);
    await this.mcpHost.attachVault(vault.root, createVaultMcpDataSource(vault));
    await this.rememberVault(vault.root);
    await this.startWatcher();
    await this.rebuildSearchIndex();
    return { rootPath: vault.root };
  }

  async pickVault(): Promise<RpcResult<VaultSessionInfo> | null> {
    const picked = await dialog.showOpenDialog({
      title: 'Open a Knowledge Studio vault',
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return null;
    }
    const opened = await openVault(picked.filePaths[0]!);
    if (!opened.ok) {
      return { ok: false, error: serializeFailure(opened.error) };
    }
    return rpc(await this.adoptVault(opened.value));
  }

  async createVaultAt(): Promise<RpcResult<VaultSessionInfo> | null> {
    const picked = await dialog.showOpenDialog({
      title: 'Choose an empty folder for the new vault',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return null;
    }
    const created = await createVault(picked.filePaths[0]!);
    if (!created.ok) {
      return { ok: false, error: serializeFailure(created.error) };
    }
    return rpc(await this.adoptVault(created.value));
  }

  async loadWorkspace(): Promise<RpcResult<WorkspaceStateDto>> {
    try {
      const raw = await fs.readFile(path.join(app.getPath('userData'), 'workspace.json'), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('invalid workspace');
      return rpc(parsed as WorkspaceStateDto);
    } catch {
      return rpc({ selectedVault: null, openTabs: [], activePath: null, editorMode: 'edit', explorerWidth: 240, rightbarWidth: 260, windowWidth: 1280, windowHeight: 800 });
    }
  }

  async pickAttachment(notePath: string): Promise<RpcResult<AttachmentDto> | null> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    const picked = await dialog.showOpenDialog({ title: 'Add attachment', properties: ['openFile', 'dontAddToRecent'] });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const copied = await copyAttachment({ vaultRoot: vault.root, sourcePath: picked.filePaths[0]!, notePath });
    if (!copied.ok) return { ok: false, error: serializeFailure(copied.error) };
    await this.writer?.recordChange({ type: 'attachment_added', path: copied.value.vaultPath, metadata: { notePath, bytes: copied.value.bytes } });
    return rpc(copied.value);
  }

  async attachmentIssues(notePath: string): Promise<RpcResult<readonly AttachmentIssueDto[]>> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    const current = await vault.readFile(notePath);
    if (!current.ok) return { ok: false, error: serializeFailure(current.error) };
    const entries = await walkVault(vault.root);
    if (!entries.ok) return { ok: false, error: serializeFailure(entries.error) };
    const notes: Array<{ path: string; content: string }> = [];
    for (const entry of entries.value) {
      if (entry.kind !== 'note') continue;
      const read = await vault.readFile(entry.path);
      if (read.ok) notes.push({ path: entry.path, content: read.value.content });
    }
    const missing = await findMissingAttachments(vault.root, notePath, current.value.content);
    const orphans = await findOrphanAttachments(vault.root, notes);
    return rpc([...missing, ...orphans]);
  }

  async aiConfigList(): Promise<RpcResult<AiConfigStatusDto>> {
    try {
      return rpc({
        providers: await this.aiConfigHost.list(),
        secureStorageAvailable: this.aiConfigHost.secureStorageAvailable,
      });
    } catch (error) {
      return { ok: false, error: serializeFailure(error) };
    }
  }

  async aiConfigUpsert(config: Omit<AiProviderConfigDto, 'hasSecret'>): Promise<RpcResult<AiProviderConfigDto>> {
    try {
      return rpc(await this.aiConfigHost.upsert(config));
    } catch (error) {
      return { ok: false, error: { code: 'AI_CONFIG_INVALID', message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async aiConfigSetSecret(providerId: string, secret: string): Promise<RpcResult<AiProviderConfigDto>> {
    try {
      return rpc(await this.aiConfigHost.setSecret(providerId, secret));
    } catch (error) {
      return { ok: false, error: { code: 'AI_SECRET_SAVE_FAILED', message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async aiConfigRemoveSecret(providerId: string): Promise<RpcResult<AiProviderConfigDto>> {
    try {
      return rpc(await this.aiConfigHost.removeSecret(providerId));
    } catch (error) {
      return { ok: false, error: { code: 'AI_SECRET_REMOVE_FAILED', message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async listPlugins(): Promise<RpcResult<readonly PluginDto[]>> {
    try {
      return rpc((await this.pluginHost.discover()).map((entry) => ({
        id: entry.manifest.id,
        name: entry.manifest.name,
        version: entry.manifest.version,
        description: entry.manifest.description,
        requestedPermissions: entry.requestedPermissions,
        trusted: entry.manifest.trusted,
        enabled: entry.enabled,
        approvedHighRisk: entry.approvedHighRisk,
        ...(entry.reason ? { reason: entry.reason } : {}),
        runtime: entry.runtime,
      })));
    } catch (error) {
      return { ok: false, error: serializeFailure(error) };
    }
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<RpcResult<readonly PluginDto[]>> {
    await this.pluginHost.setEnabled(pluginId, enabled);
    return this.listPlugins();
  }

  async approvePluginHighRisk(pluginId: string, permission: 'PROCESS_EXECUTE' | 'SECRETS', approved: boolean): Promise<RpcResult<readonly PluginDto[]>> {
    await this.pluginHost.approveHighRisk(pluginId, permission, approved);
    return this.listPlugins();
  }

  mcpStatus(): RpcResult<McpStatusDto> {
    return rpc({ ...this.mcpHost.status, readOnly: true });
  }

  async mcpStart(port: number | undefined): Promise<RpcResult<McpStatusDto>> {
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
      return { ok: false, error: { code: 'MCP_PORT_INVALID', message: 'Port must be an integer from 0 through 65535' } };
    }
    try {
      const status = await this.mcpHost.start(port ?? 0);
      return rpc({ ...status, readOnly: true });
    } catch (error) {
      return { ok: false, error: { code: 'MCP_START_FAILED', message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async mcpStop(): Promise<RpcResult<McpStatusDto>> {
    await this.mcpHost.stop();
    return rpc({ ...this.mcpHost.status, readOnly: true });
  }

  async gitStatus(): Promise<RpcResult<GitStatusDto>> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    const status = await new GitClient({ cwd: vault.root }).status();
    return rpc(status);
  }

  async gitDiff(paths: readonly string[]): Promise<RpcResult<GitDiffDto>> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    const result = await new GitClient({ cwd: vault.root }).diff(paths);
    return result.ok ? rpc(result.value) : { ok: false, error: { code: 'GIT_DIFF_FAILED', message: result.error } };
  }

  async gitCommitSelected(paths: readonly string[], message: string): Promise<RpcResult<{ hash: string }>> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    const result = await new GitClient({ cwd: vault.root }).commitSelected(paths, message);
    return result.ok ? rpc({ hash: result.hash }) : { ok: false, error: { code: 'GIT_COMMIT_FAILED', message: result.error } };
  }

  async listHistory(notePath: string): Promise<RpcResult<readonly RevisionDto[]>> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    if (!this.history) return { ok: false, error: { code: 'HISTORY_UNAVAILABLE', message: 'History is unavailable' } };
    try {
      return rpc(await this.history.list(notePath));
    } catch (error) {
      return { ok: false, error: serializeFailure(error) };
    }
  }

  async readHistory(notePath: string, revisionId: string): Promise<RpcResult<string>> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    if (!this.history) return { ok: false, error: { code: 'HISTORY_UNAVAILABLE', message: 'History is unavailable' } };
    const content = await this.history.read(notePath, revisionId);
    return content === null
      ? { ok: false, error: { code: 'HISTORY_REVISION_NOT_FOUND', message: 'Revision was not found' } }
      : rpc(content);
  }

  async readCanvas(canvasPath: string): Promise<RpcResult<string>> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    const result = await vault.readFile(canvasPath);
    return result.ok ? rpc(result.value.content) : { ok: false, error: serializeFailure(result.error) };
  }

  async writeCanvas(canvasPath: string, content: string): Promise<RpcResult<true>> {
    const vault = this.requireVault();
    if (!('root' in vault)) return { ok: false, error: vault };
    const result = await vault.writeFile(canvasPath, content);
    return result.ok ? rpc(true) : { ok: false, error: serializeFailure(result.error) };
  }

  async saveWorkspace(state: WorkspaceStateDto): Promise<RpcResult<true>> {
    try {
      const workspacePath = path.join(app.getPath('userData'), 'workspace.json');
      await fs.mkdir(path.dirname(workspacePath), { recursive: true });
      await fs.writeFile(workspacePath, JSON.stringify(state, null, 2));
      return rpc(true);
    } catch (error) {
      return { ok: false, error: serializeFailure(error) };
    }
  }

  async reopenLast(): Promise<RpcResult<VaultSessionInfo> | null> {
    const last = await this.lastVaultPath();
    if (last === null) {
      return null;
    }
    const opened = await openVault(last);
    if (!opened.ok) {
      return null; // Vault moved or deleted: fall back to the welcome screen.
    }
    return rpc(await this.adoptVault(opened.value));
  }

  private async closeInternal(): Promise<void> {
    await this.mcpHost.detachVault();
    this.watcherDisposer?.close();
    this.watcherDisposer = null;
    this.vault?.close();
    this.vault = null;
    this.history = null;
    this.writer = null;
    this.bases = null;
    this.clipper = null;
    this.pdf = null;
    this.searchIndex.close();
  }

  async close(): Promise<void> {
    await this.closeInternal();
  }

  private requireVault(): Vault | RpcError {
    if (!this.vault) {
      return { code: 'VAULT_NOT_OPEN', message: 'No vault is open' };
    }
    return this.vault;
  }

  async listEntries(): Promise<RpcResult<readonly EntryDto[]>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    const entries = await walkVault(vault.root);
    if (!entries.ok) {
      return { ok: false, error: serializeFailure(entries.error) };
    }
    return rpc(entries.value.map(toEntryDto));
  }

  async readNote(vaultPath: string): Promise<RpcResult<ReadNoteResult>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    const result = await vault.readFile(vaultPath);
    return result.ok
      ? rpc({ content: result.value.content, mtimeMs: result.value.mtimeMs, size: result.value.size })
      : { ok: false, error: serializeFailure(result.error) };
  }

  async writeNote(
    vaultPath: string,
    content: string,
    expectedMtimeMs: number | undefined,
  ): Promise<RpcResult<WriteNoteResult>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    if (!this.writer) return { ok: false, error: { code: 'VAULT_NOT_OPEN', message: 'No vault is open' } };
    const result = await this.writer.write(vaultPath, content, expectedMtimeMs !== undefined ? { expectedMtimeMs } : {});
    return result.ok ? rpc({ mtimeMs: result.value.mtimeMs }) : result;
  }

  async createNote(vaultPath: string, content: string): Promise<RpcResult<string>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    const exists = await vault.exists(vaultPath);
    if (!exists.ok) {
      return { ok: false, error: serializeFailure(exists.error) };
    }
    if (exists.value || !this.writer) {
      return { ok: false, error: { code: 'VAULT_PATH_EXISTS', message: 'A file with that name already exists' } };
    }
    const written = await this.writer.write(vaultPath, content, { createOnly: true });
    return written.ok ? rpc(vaultPath) : written;
  }

  async renameEntry(from: string, to: string): Promise<RpcResult<string>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    const result = await vault.rename(from, to);
    if (!result.ok) return { ok: false, error: serializeFailure(result.error) };
    await this.writer?.recordChange({ type: 'document_moved', oldPath: from, path: result.value });
    return rpc(result.value);
  }

  async deleteEntry(vaultPath: string): Promise<RpcResult<string>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    const trashed = await vault.deleteToTrash(vaultPath);
    if (!trashed.ok) return { ok: false, error: serializeFailure(trashed.error) };
    await this.writer?.recordChange({ type: 'document_deleted', path: vaultPath });
    return rpc(trashed.value.id);
  }

  private requireBases(): BasesHost | RpcError {
    return this.bases ?? { code: 'VAULT_NOT_OPEN', message: 'No vault is open' };
  }

  async basesCall<T>(call: (bases: BasesHost) => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
    const bases = this.requireBases();
    if (!(bases instanceof BasesHost)) return { ok: false, error: bases };
    try {
      return await call(bases);
    } catch (error) {
      return { ok: false, error: serializeFailure(error) };
    }
  }

  async clipperCall<T>(call: (clipper: WebClipperHost) => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
    if (!this.clipper) return { ok: false, error: { code: 'VAULT_NOT_OPEN', message: 'No vault is open' } };
    try {
      return await call(this.clipper);
    } catch (error) {
      return { ok: false, error: serializeFailure(error) };
    }
  }

  async pdfCall<T>(call: (pdf: PdfHost) => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
    if (!this.pdf) return { ok: false, error: { code: 'VAULT_NOT_OPEN', message: 'No vault is open' } };
    try {
      return await call(this.pdf);
    } catch (error) {
      return { ok: false, error: serializeFailure(error) };
    }
  }

  async clipperImportFile(): Promise<RpcResult<ClipResultDto> | null> {
    if (!this.clipper) return { ok: false, error: { code: 'VAULT_NOT_OPEN', message: 'No vault is open' } };
    const picked = await dialog.showOpenDialog({ title: 'Import a saved web page', properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'Saved pages', extensions: ['html', 'htm', 'txt'] }] });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const clipper = this.clipper;
    return this.clipperCall(() => clipper.clipFile(picked.filePaths[0]!));
  }

  /** Rebuilds (or creates) the FTS5 index over every note in the vault. */
  async rebuildSearchIndex(): Promise<RpcResult<{ indexedNotes: number }>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    const entries = await walkVault(vault.root);
    if (!entries.ok) {
      return { ok: false, error: serializeFailure(entries.error) };
    }
    const dbPath = path.join(vault.appDir, 'index.db');
    if (!this.searchIndex.isOpen || this.searchIndex.path !== dbPath) {
      this.searchIndex.close();
      const opened = this.searchIndex.open(dbPath);
      if (!opened.ok) {
        return { ok: false, error: serializeFailure(opened.error) };
      }
    }
    const notes: Array<{ path: string; content: string }> = [];
    for (const entry of entries.value) {
      if (entry.kind !== 'note') {
        continue;
      }
      const read = await vault.readFile(entry.path);
      if (read.ok) {
        notes.push({ path: entry.path, content: read.value.content });
      }
    }
    const rebuilt = this.searchIndex.rebuild(notes);
    return rebuilt.ok
      ? rpc({ indexedNotes: rebuilt.value })
      : { ok: false, error: serializeFailure(rebuilt.error) };
  }

  searchNotes(query: string): RpcResult<readonly SearchHitDto[]> {
    if (!this.searchIndex.isOpen) {
      return { ok: false, error: { code: 'VAULT_NOT_OPEN', message: 'No vault is open' } };
    }
    const hits = this.searchIndex.search(query, { limit: 50 });
    return hits.ok
      ? rpc(hits.value)
      : { ok: false, error: serializeFailure(hits.error) };
  }

  /** Keeps the FTS5 index in step with watcher events. */
  private syncIndexOnEvent(event: VaultEventDto): void {
    const vault = this.vault;
    if (!vault || !this.searchIndex.isOpen) {
      return;
    }
    if (event.kind === 'deleted') {
      const removed = this.searchIndex.remove(event.vaultPath);
      if (!removed.ok) {
        void removed;
      }
      return;
    }
    void vault
      .readFile(event.vaultPath)
      .then((read) => {
        if (read.ok) {
          void this.searchIndex.upsert({ path: event.vaultPath, content: read.value.content });
        } else if (event.kind === 'changed') {
          // File disappeared between event and read; drop it.
          void this.searchIndex.remove(event.vaultPath);
        }
      })
      .catch(() => undefined);
  }

  private async startWatcher(): Promise<void> {
    const vault = this.vault;
    if (!vault) {
      return;
    }
    const watched = await vault.watch({
      onFileEvent: (event) => {
        const dto: VaultEventDto = { kind: event.kind, vaultPath: event.vaultPath };
        this.renderer?.webContents.send(IPC.vaultEvent, dto);
        this.syncIndexOnEvent(dto);
      },
      onError: () => {
        // Watcher failures are non-fatal; the UI degrades to manual refresh.
      },
    });
    if (watched.ok) {
      this.watcherDisposer = watched.value;
    }
  }
}

/** Registers all vault IPC handlers. Returns the host for lifecycle control. */
export function registerVaultIpc(win: BrowserWindow): VaultHost {
  const host = new VaultHost();
  host.bindWindow(win);

  ipcMain.handle(IPC.init, (): InitInfo => ({
    version: app.getVersion(),
    platform: process.platform,
  }));

  ipcMain.handle(IPC.pickVault, () => host.pickVault());
  ipcMain.handle(IPC.createVault, () => host.createVaultAt());
  ipcMain.handle(IPC.reopenVault, () => host.reopenLast());
  ipcMain.handle(IPC.closeVault, () => host.close());
  ipcMain.handle(IPC.listEntries, () => host.listEntries());
  ipcMain.handle(IPC.readNote, (_event, vaultPath: string) => host.readNote(vaultPath));
  ipcMain.handle(IPC.writeNote, (_event, vaultPath: string, content: string, expectedMtimeMs?: number) =>
    host.writeNote(vaultPath, content, expectedMtimeMs),
  );
  ipcMain.handle(IPC.createNote, (_event, vaultPath: string, content: string) =>
    host.createNote(vaultPath, content),
  );
  ipcMain.handle(IPC.renameEntry, (_event, from: string, to: string) => host.renameEntry(from, to));
  ipcMain.handle(IPC.deleteEntry, (_event, vaultPath: string) => host.deleteEntry(vaultPath));
  ipcMain.handle(IPC.search, (_event, query: string) => host.searchNotes(query));
  ipcMain.handle(IPC.rebuildIndex, () => host.rebuildSearchIndex());
  ipcMain.handle(IPC.loadWorkspace, () => host.loadWorkspace());
  ipcMain.handle(IPC.saveWorkspace, (_event, state: WorkspaceStateDto) => host.saveWorkspace(state));
  ipcMain.handle(IPC.readCanvas, (_event, canvasPath: string) => host.readCanvas(canvasPath));
  ipcMain.handle(IPC.writeCanvas, (_event, canvasPath: string, content: string) => host.writeCanvas(canvasPath, content));
  ipcMain.handle(IPC.historyList, (_event, notePath: string) => host.listHistory(notePath));
  ipcMain.handle(IPC.historyRead, (_event, notePath: string, revisionId: string) => host.readHistory(notePath, revisionId));
  ipcMain.handle(IPC.gitStatus, () => host.gitStatus());
  ipcMain.handle(IPC.gitDiff, (_event, paths: readonly string[]) => host.gitDiff(paths));
  ipcMain.handle(IPC.gitCommitSelected, (_event, paths: readonly string[], message: string) => host.gitCommitSelected(paths, message));
  ipcMain.handle(IPC.mcpStatus, () => host.mcpStatus());
  ipcMain.handle(IPC.mcpStart, (_event, port?: number) => host.mcpStart(port));
  ipcMain.handle(IPC.mcpStop, () => host.mcpStop());
  ipcMain.handle(IPC.pluginList, () => host.listPlugins());
  ipcMain.handle(IPC.pluginSetEnabled, (_event, pluginId: string, enabled: boolean) => host.setPluginEnabled(pluginId, enabled));
  ipcMain.handle(IPC.pluginApproveHighRisk, (_event, pluginId: string, permission: 'PROCESS_EXECUTE' | 'SECRETS', approved: boolean) => host.approvePluginHighRisk(pluginId, permission, approved));
  ipcMain.handle(IPC.aiConfigList, () => host.aiConfigList());
  ipcMain.handle(IPC.aiConfigUpsert, (_event, config: Omit<AiProviderConfigDto, 'hasSecret'>) => host.aiConfigUpsert(config));
  ipcMain.handle(IPC.aiConfigSetSecret, (_event, providerId: string, secret: string) => host.aiConfigSetSecret(providerId, secret));
  ipcMain.handle(IPC.aiConfigRemoveSecret, (_event, providerId: string) => host.aiConfigRemoveSecret(providerId));
  ipcMain.handle(IPC.attachmentPick, (_event, notePath: string) => host.pickAttachment(notePath));
  ipcMain.handle(IPC.attachmentIssues, (_event, notePath: string) => host.attachmentIssues(notePath));
  // Bases: every argument is `unknown` here and runtime-validated in BasesHost.
  ipcMain.handle(IPC.basesList, () => host.basesCall((bases) => bases.list()));
  ipcMain.handle(IPC.basesSave, (_event, definition: unknown, expectedRevision: unknown) => host.basesCall((bases) => bases.save(definition, expectedRevision)));
  ipcMain.handle(IPC.basesDelete, (_event, id: unknown, expectedRevision: unknown) => host.basesCall((bases) => bases.remove(id, expectedRevision)));
  ipcMain.handle(IPC.basesQuery, (_event, id: unknown) => host.basesCall((bases) => bases.query(id)));
  ipcMain.handle(IPC.clipperClip, (_event, input: unknown) => host.clipperCall((clipper) => clipper.clip(input)));
  ipcMain.handle(IPC.clipperImportFile, () => host.clipperImportFile());
  // PDF: arguments are `unknown` and validated by PdfHost; only vault-relative .pdf paths are accepted.
  ipcMain.handle(IPC.pdfRead, (_event, pdfPath: unknown) => host.pdfCall((pdf) => pdf.read(pdfPath)));
  ipcMain.handle(IPC.pdfAnnotationsList, (_event, pdfPath: unknown) => host.pdfCall((pdf) => pdf.list(pdfPath)));
  ipcMain.handle(IPC.pdfAnnotationAdd, (_event, pdfPath: unknown, annotation: unknown, expectedRevision: unknown, title: unknown) => host.pdfCall((pdf) => pdf.add(pdfPath, annotation, expectedRevision, title)));
  ipcMain.handle(IPC.pdfAnnotationUpdate, (_event, pdfPath: unknown, id: unknown, patch: unknown, expectedRevision: unknown) => host.pdfCall((pdf) => pdf.update(pdfPath, id, patch, expectedRevision)));
  ipcMain.handle(IPC.pdfAnnotationRemove, (_event, pdfPath: unknown, id: unknown, expectedRevision: unknown) => host.pdfCall((pdf) => pdf.remove(pdfPath, id, expectedRevision)));
  ipcMain.handle(IPC.pdfExportNote, (_event, pdfPath: unknown, title: unknown) => host.pdfCall((pdf) => pdf.exportNote(pdfPath, title)));
  ipcMain.handle(IPC.basesSetField, (_event, edit: unknown) => host.basesCall((bases) => bases.setField(edit)));
  return host;
}
