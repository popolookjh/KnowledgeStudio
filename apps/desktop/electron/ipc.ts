import { app, dialog, ipcMain } from 'electron';
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
import { IPC } from '../shared/ipc-contract.js';
import type {
  EntryDto,
  InitInfo,
  ReadNoteResult,
  RpcError,
  RpcResult,
  VaultEventDto,
  VaultSessionInfo,
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
    this.closeInternal();
    this.vault = vault;
    await this.rememberVault(vault.root);
    await this.startWatcher();
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

  private closeInternal(): void {
    this.watcherDisposer?.close();
    this.watcherDisposer = null;
    this.vault?.close();
    this.vault = null;
  }

  close(): void {
    this.closeInternal();
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
    const result = await vault.writeFile(vaultPath, content, { expectedMtimeMs });
    return result.ok
      ? rpc({ mtimeMs: result.value.mtimeMs })
      : { ok: false, error: serializeFailure(result.error) };
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
    if (exists.value) {
      return { ok: false, error: { code: 'VAULT_PATH_EXISTS', message: 'A file with that name already exists' } };
    }
    const written = await vault.writeFile(vaultPath, content);
    return written.ok ? rpc(vaultPath) : { ok: false, error: serializeFailure(written.error) };
  }

  async renameEntry(from: string, to: string): Promise<RpcResult<string>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    const result = await vault.rename(from, to);
    return result.ok ? rpc(result.value) : { ok: false, error: serializeFailure(result.error) };
  }

  async deleteEntry(vaultPath: string): Promise<RpcResult<string>> {
    const vault = this.requireVault();
    if (!('root' in vault)) {
      return { ok: false, error: vault };
    }
    const trashed = await vault.deleteToTrash(vaultPath);
    return trashed.ok ? rpc(trashed.value.id) : { ok: false, error: serializeFailure(trashed.error) };
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
  return host;
}
