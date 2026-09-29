import { readMetadata, writeMetadata } from '@knowledge-studio/metadata';
import { useSyncExternalStore } from 'react';
import type { BridgeApi, EntryDto, VaultEventDto } from '../../shared/ipc-contract';
import { noteTitleFromPath } from '../../shared/ipc-contract';
import { linkIndex } from './linkIndex';
import { tagIndex } from './tagIndex';

/**
 * Renderer application store: vault session, file listing, open tabs with
 * unsaved state, autosave, and external-change handling.
 *
 * Plain observable + `useSyncExternalStore` — no state library needed at
 * this size. All mutations produce new state objects (immutable snapshots).
 */

export type EditorMode = 'edit' | 'split' | 'preview';

export interface Tab {
  readonly path: string;
  readonly title: string;
  /** Current editor buffer. */
  content: string;
  /** Content as last written to disk (for autosave decisions). */
  savedContent: string;
  /** mtime of the last read/write — the optimistic-concurrency token. */
  savedMtimeMs: number;
  readonly openedAt: number;
}

export interface AppStatus {
  readonly message: string;
  readonly tone: 'info' | 'error';
}

export interface AppState {
  readonly bridge: BridgeApi | null;
  readonly sessionRoot: string | null;
  readonly entries: readonly EntryDto[];
  readonly tabs: readonly Tab[];
  readonly activePath: string | null;
  readonly mode: EditorMode;
  readonly watcherActive: boolean;
  readonly status: AppStatus | null;
  /** Path of the tab whose on-disk file changed under an unsaved buffer. */
  readonly conflictPath: string | null;
  readonly bootstrapped: boolean;
  readonly graphOpen: boolean;
  readonly sidebarCollapsed: boolean;
  readonly canvasOpen: boolean;
  readonly basesOpen: boolean;
}

const AUTOSAVE_DELAY_MS = 800;

function bridge(): BridgeApi | null {
  return typeof window === 'undefined' ? null : (window.knowledgeStudio ?? null);
}

class Store {
  private state: AppState = {
    bridge: bridge(),
    sessionRoot: null,
    entries: [],
    tabs: [],
    activePath: null,
    mode: 'edit',
    watcherActive: false,
    status: null,
    conflictPath: null,
    bootstrapped: false,
    graphOpen: false,
    sidebarCollapsed: false,
    canvasOpen: false,
    basesOpen: false,
  };

  private readonly listeners = new Set<() => void>();
  private workspaceTimer: ReturnType<typeof setTimeout> | null = null;

  private autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
    if (this.state.bridge && this.state.sessionRoot) {
      if (this.workspaceTimer) clearTimeout(this.workspaceTimer);
      this.workspaceTimer = setTimeout(() => { void this.persistWorkspace(); }, 250);
    }
  }

  private setStatus(message: string, tone: AppStatus['tone'] = 'info'): void {
    this.set({ status: { message, tone } });
  }

  clearStatus(): void {
    this.set({ status: null });
  }

  /** Boot: reopen the last vault if possible, subscribe to watcher events. */
  async bootstrap(): Promise<void> {
    const api = this.state.bridge;
    if (!api) {
      this.set({ bootstrapped: true });
      return;
    }
    const reopened = await api.reopenVault();
    if (reopened && reopened.ok) {
      this.set({ sessionRoot: reopened.value.rootPath, watcherActive: true });
      await this.refreshEntries();
      const workspace = await api.loadWorkspace();
      if (workspace.ok && workspace.value.selectedVault === reopened.value.rootPath) {
        this.set({ mode: workspace.value.editorMode, activePath: workspace.value.activePath });
        for (const tabPath of workspace.value.openTabs) await this.openNote(tabPath);
      }
    }
    api.onVaultEvent((event) => {
      void this.handleVaultEvent(event);
    });
    this.set({ bootstrapped: true });
  }

  async pickVault(): Promise<void> {
    const api = this.state.bridge;
    if (!api) {
      return;
    }
    const result = await api.pickVault();
    if (!result) {
      return; // dialog canceled
    }
    if (!result.ok) {
      this.setStatus(result.error.message, 'error');
      return;
    }
    this.set({
      sessionRoot: result.value.rootPath,
      tabs: [],
      activePath: null,
      conflictPath: null,
      watcherActive: true,
      status: null,
    });
    await this.refreshEntries();
  }

  async createVault(): Promise<void> {
    const api = this.state.bridge;
    if (!api) {
      return;
    }
    const result = await api.createVault();
    if (!result) {
      return; // dialog canceled
    }
    if (!result.ok) {
      this.setStatus(result.error.message, 'error');
      return;
    }
    this.set({
      sessionRoot: result.value.rootPath,
      tabs: [],
      activePath: null,
      conflictPath: null,
      watcherActive: true,
      status: null,
    });
    await this.refreshEntries();
  }

  async closeVault(): Promise<void> {
    const api = this.state.bridge;
    if (!api) {
      return;
    }
    await api.closeVault();
    this.set({ sessionRoot: null, entries: [], tabs: [], activePath: null, watcherActive: false });
  }

  async refreshEntries(): Promise<void> {
    const api = this.state.bridge;
    if (!api || !this.state.sessionRoot) {
      return;
    }
    const result = await api.listEntries();
    if (result.ok) {
      this.set({ entries: result.value });
      void this.rebuildLinkIndex();
    } else {
      this.setStatus(result.error.message, 'error');
    }
  }

  /** Rebuilds the renderer link index over all notes in the vault. */
  private async rebuildLinkIndex(): Promise<void> {
    const api = this.state.bridge;
    if (!api) {
      return;
    }
    const notes = this.state.entries
      .filter((entry) => entry.kind === 'note')
      .map((entry) => entry.path);
    await linkIndex.rebuild(notes, async (vaultPath) => {
      const read = await api.readNote(vaultPath);
      return read.ok ? read.value.content : null;
    });
    const tagNotes = await Promise.all(
      notes.map(async (vaultPath) => {
        const read = await api.readNote(vaultPath);
        return read.ok ? { path: vaultPath, content: read.value.content } : null;
      }),
    );
    tagIndex.rebuild(tagNotes.filter((note): note is { path: string; content: string } => note !== null));
  }

  async openNote(vaultPath: string): Promise<void> {
    const api = this.state.bridge;
    if (!api) {
      return;
    }
    const existing = this.state.tabs.find((tab) => tab.path === vaultPath);
    if (existing) {
      this.set({ activePath: vaultPath });
      return;
    }
    const result = await api.readNote(vaultPath);
    if (!result.ok) {
      this.setStatus(result.error.message, 'error');
      return;
    }
    const tab: Tab = {
      path: vaultPath,
      title: noteTitleFromPath(vaultPath),
      content: result.value.content,
      savedContent: result.value.content,
      savedMtimeMs: result.value.mtimeMs,
      openedAt: Date.now(),
    };
    this.set({ tabs: [...this.state.tabs, tab], activePath: vaultPath, conflictPath: null });
    linkIndex.updateNote(vaultPath, result.value.content);
    tagIndex.update(vaultPath, result.value.content);
  }

  setActiveTab(vaultPath: string): void {
    this.set({ activePath: vaultPath });
  }

  closeTab(vaultPath: string): void {
    const index = this.state.tabs.findIndex((tab) => tab.path === vaultPath);
    if (index === -1) {
      return;
    }
    const timer = this.autosaveTimers.get(vaultPath);
    if (timer) {
      clearTimeout(timer);
      this.autosaveTimers.delete(vaultPath);
    }
    const tabs = this.state.tabs.filter((tab) => tab.path !== vaultPath);
    const closing = this.state.activePath === vaultPath;
    const nextActive = closing
      ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null)
      : this.state.activePath;
    this.set({
      tabs,
      activePath: nextActive,
      conflictPath: this.state.conflictPath === vaultPath ? null : this.state.conflictPath,
    });
  }

  setMode(mode: EditorMode): void {
    this.set({ mode });
  }

  updateContent(vaultPath: string, content: string): void {
    const tabs = this.state.tabs.map((tab) =>
      tab.path === vaultPath ? { ...tab, content } : tab,
    );
    this.set({ tabs });
    linkIndex.updateNote(vaultPath, content);
    tagIndex.update(vaultPath, content);
    this.scheduleAutosave(vaultPath);
  }

  private scheduleAutosave(vaultPath: string): void {
    const existing = this.autosaveTimers.get(vaultPath);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.autosaveTimers.delete(vaultPath);
      void this.saveNote(vaultPath);
    }, AUTOSAVE_DELAY_MS);
    this.autosaveTimers.set(vaultPath, timer);
  }

  async saveNote(vaultPath: string): Promise<boolean> {
    const api = this.state.bridge;
    const tab = this.state.tabs.find((entry) => entry.path === vaultPath);
    if (!api || !tab) {
      return false;
    }
    if (tab.content === tab.savedContent && tab.savedMtimeMs !== 0) {
      return true; // nothing to write
    }
    const result = await api.writeNote(vaultPath, tab.content, tab.savedMtimeMs);
    if (!result.ok) {
      if (result.error.code === 'VAULT_MODIFIED_SINCE_READ') {
        this.set({ conflictPath: vaultPath });
        this.setStatus('The file changed on disk while you were editing', 'error');
      } else {
        this.setStatus(`Save failed: ${result.error.message}`, 'error');
      }
      return false;
    }
    const updated = this.state.tabs.map((entry) =>
      entry.path === vaultPath
        ? { ...entry, savedContent: entry.content, savedMtimeMs: result.value.mtimeMs }
        : entry,
    );
    this.set({
      tabs: updated,
      conflictPath: this.state.conflictPath === vaultPath ? null : this.state.conflictPath,
    });
    return true;
  }

  /** Conflict resolution: keep the editor buffer, overwrite the disk file. */
  async overwriteFromEditor(vaultPath: string): Promise<void> {
    const api = this.state.bridge;
    const tab = this.state.tabs.find((entry) => entry.path === vaultPath);
    if (!api || !tab) {
      return;
    }
    const result = await api.writeNote(vaultPath, tab.content);
    if (!result.ok) {
      this.setStatus(`Overwrite failed: ${result.error.message}`, 'error');
      return;
    }
    const tabs = this.state.tabs.map((entry) =>
      entry.path === vaultPath
        ? { ...entry, savedContent: entry.content, savedMtimeMs: result.value.mtimeMs }
        : entry,
    );
    this.set({ tabs, conflictPath: null, status: null });
  }

  /** Conflict resolution: discard the editor buffer, reload from disk. */
  async reloadFromDisk(vaultPath: string): Promise<void> {
    const api = this.state.bridge;
    if (!api) {
      return;
    }
    const result = await api.readNote(vaultPath);
    if (!result.ok) {
      this.setStatus(result.error.message, 'error');
      return;
    }
    const tabs = this.state.tabs.map((entry) =>
      entry.path === vaultPath
        ? {
            ...entry,
            content: result.value.content,
            savedContent: result.value.content,
            savedMtimeMs: result.value.mtimeMs,
          }
        : entry,
    );
    this.set({ tabs, conflictPath: null, status: null });
    linkIndex.updateNote(vaultPath, result.value.content);
  }

  private suggestNotePath(folder: string): string {
    const existing = new Set(this.state.entries.map((entry) => entry.path));
    const base = folder.length === 0 ? '' : `${folder}/`;
    let candidate = `${base}untitled.md`;
    let counter = 2;
    while (existing.has(candidate) && counter < 1000) {
      candidate = `${base}untitled-${counter}.md`;
      counter += 1;
    }
    return candidate;
  }

  async addAttachment(vaultPath: string): Promise<void> {
    const api = this.state.bridge;
    const tab = this.state.tabs.find((entry) => entry.path === vaultPath);
    if (!api || !tab) return;
    const result = await api.pickAttachment(vaultPath);
    if (result === null) return;
    if (!result.ok) {
      this.setStatus(`Attachment failed: ${result.error.message}`, 'error');
      return;
    }
    const separator = tab.content.endsWith('\n') ? '' : '\n';
    this.updateContent(vaultPath, `${tab.content}${separator}\n${result.value.markdownLink}\n`);
    await this.saveNote(vaultPath);
    this.setStatus(`Attached ${result.value.vaultPath}`);
  }

  async createNoteInFolder(folder: string): Promise<void> {
    const api = this.state.bridge;
    if (!api || !this.state.sessionRoot) return;
    const path = this.suggestNotePath(folder);
    const created = await api.createNote(path, '# Untitled\n\n');
    if (!created.ok) {
      this.setStatus(created.error.message, 'error');
      return;
    }
    await this.refreshEntries();
    await this.openNote(path);
  }

  async restoreHistoryRevision(vaultPath: string, revisionId: string): Promise<boolean> {
    const api = this.state.bridge;
    const tab = this.state.tabs.find((entry) => entry.path === vaultPath);
    if (!api || !tab) return false;
    const revision = await api.readHistory(vaultPath, revisionId);
    if (!revision.ok) {
      this.setStatus(`Revision restore failed: ${revision.error.message}`, 'error');
      return false;
    }
    this.updateContent(vaultPath, revision.value);
    return this.saveNote(vaultPath);
  }

  async createNoteFromLink(target: string, heading: string | null): Promise<void> {
    const api = this.state.bridge;
    if (!api || !this.state.sessionRoot) {
      return;
    }
    const withExtension = target.includes('.') ? target : `${target}.md`;
    const created = await api.createNote(
      withExtension,
      heading ? `# ${heading}\n\n` : '# Untitled\n\n',
    );
    if (!created.ok) {
      this.setStatus(created.error.message, 'error');
      return;
    }
    await this.refreshEntries();
    await this.openNote(withExtension);
  }

  /**
   * Edits one frontmatter property of an open note (Phase 4): parse →
   * patch → re-serialize via the metadata package, then save. The body is
   * preserved byte-for-byte; unknown properties survive untouched.
   */
  async setMetadataProperty(vaultPath: string, key: string, value: string | string[] | null): Promise<void> {
    const api = this.state.bridge;
    const tab = this.state.tabs.find((entry) => entry.path === vaultPath);
    if (!api || !tab) {
      return;
    }
    const { data } = readMetadata(tab.content);
    const patch = { ...data };
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete patch[key];
    } else if (key === 'tags' || key === 'aliases') {
      patch[key] = Array.isArray(value) ? value : value.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
    } else if (key === 'confidence') {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        patch[key] = numeric;
      }
    } else {
      patch[key] = value;
    }
    const updated = writeMetadata(tab.content, patch);
    if (!updated.ok) {
      this.setStatus(updated.error.map((issue) => issue.message).join('; '), 'error');
      return;
    }
    this.updateContent(vaultPath, updated.value);
    await this.saveNote(vaultPath);
  }

  openGraph(): void {
    this.set({ graphOpen: true });
  }

  closeGraph(): void {
    this.set({ graphOpen: false });
  }

  toggleSidebar(): void {
    this.set({ sidebarCollapsed: !this.state.sidebarCollapsed });
  }

  openCanvas(): void { this.set({ canvasOpen: true }); }
  closeCanvas(): void { this.set({ canvasOpen: false }); }
  openBases(): void { this.set({ basesOpen: true }); }
  closeBases(): void { this.set({ basesOpen: false }); }

  private async persistWorkspace(): Promise<void> {
    const api = this.state.bridge;
    if (!api) return;
    await api.saveWorkspace({
      selectedVault: this.state.sessionRoot,
      openTabs: this.state.tabs.map((tab) => tab.path),
      activePath: this.state.activePath,
      editorMode: this.state.mode,
      explorerWidth: 240,
      rightbarWidth: 260,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    });
  }

  /** Full rebuild of the FTS5 index from Markdown (recovery path). */
  async rebuildIndex(): Promise<void> {
    const api = this.state.bridge;
    if (!api) {
      return;
    }
    const result = await api.rebuildIndex();
    if (result.ok) {
      this.setStatus(`Index rebuilt: ${result.value.indexedNotes} notes`);
    } else {
      this.setStatus(`Index rebuild failed: ${result.error.message}`, 'error');
    }
  }

  async deleteNote(vaultPath: string): Promise<void> {
    const api = this.state.bridge;
    if (!api || !this.state.sessionRoot) {
      return;
    }
    const trashed = await api.deleteEntry(vaultPath);
    if (!trashed.ok) {
      this.setStatus(trashed.error.message, 'error');
      return;
    }
    this.closeTab(vaultPath);
    await this.refreshEntries();
    this.setStatus(`Moved to vault trash: ${vaultPath}`);
  }

  private async handleVaultEvent(event: VaultEventDto): Promise<void> {
    if (!this.state.sessionRoot) {
      return;
    }
    const openTab = this.state.tabs.find((tab) => tab.path === event.vaultPath);
    if (event.kind === 'deleted') {
      if (openTab) {
        this.closeTab(event.vaultPath);
        this.setStatus(`File deleted outside the editor: ${event.vaultPath}`, 'error');
      }
      linkIndex.removeNote(event.vaultPath);
      tagIndex.remove(event.vaultPath);
      await this.refreshEntries();
      return;
    }
    if (event.kind === 'created') {
      await this.refreshEntries();
      // Index the new file's content immediately so its links resolve.
      const api = this.state.bridge;
      if (api && !openTab) {
        const read = await api.readNote(event.vaultPath);
        if (read.ok) {
          linkIndex.updateNote(event.vaultPath, read.value.content);
        }
      }
      return;
    }
    // changed
    await this.refreshEntries();
    if (!openTab) {
      const api = this.state.bridge;
      if (api) {
        const read = await api.readNote(event.vaultPath);
        if (read.ok) {
          linkIndex.updateNote(event.vaultPath, read.value.content);
        }
      }
      return;
    }
    if (openTab.content === openTab.savedContent) {
      await this.reloadFromDisk(event.vaultPath);
    } else if (this.state.conflictPath !== event.vaultPath) {
      this.set({ conflictPath: event.vaultPath });
      this.setStatus('The file changed on disk while you were editing', 'error');
    }
  }
}

export const store = new Store();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
