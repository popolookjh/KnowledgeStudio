import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-contract.js';
import type { BridgeApi, VaultEventDto } from '../shared/ipc-contract.js';

/**
 * Preload bridge. Runs with `sandbox: true`; the renderer gets exactly this
 * flat, promise-based surface — no ipcRenderer, no Node, no paths beyond
 * the vault root the user chose.
 */
const api: BridgeApi = {
  version: process.env['npm_package_version'] ?? '0.0.0',
  platform: process.platform,
  init: () => ipcRenderer.invoke(IPC.init),
  pickVault: () => ipcRenderer.invoke(IPC.pickVault),
  createVault: () => ipcRenderer.invoke(IPC.createVault),
  reopenVault: () => ipcRenderer.invoke(IPC.reopenVault),
  closeVault: () => ipcRenderer.invoke(IPC.closeVault),
  listEntries: () => ipcRenderer.invoke(IPC.listEntries),
  readNote: (vaultPath) => ipcRenderer.invoke(IPC.readNote, vaultPath),
  writeNote: (vaultPath, content, expectedMtimeMs) =>
    ipcRenderer.invoke(IPC.writeNote, vaultPath, content, expectedMtimeMs),
  createNote: (vaultPath, content) => ipcRenderer.invoke(IPC.createNote, vaultPath, content),
  renameEntry: (from, to) => ipcRenderer.invoke(IPC.renameEntry, from, to),
  deleteEntry: (vaultPath) => ipcRenderer.invoke(IPC.deleteEntry, vaultPath),
  search: (query) => ipcRenderer.invoke(IPC.search, query),
  rebuildIndex: () => ipcRenderer.invoke(IPC.rebuildIndex),
  loadWorkspace: () => ipcRenderer.invoke(IPC.loadWorkspace),
  saveWorkspace: (state) => ipcRenderer.invoke(IPC.saveWorkspace, state),
  readCanvas: (path) => ipcRenderer.invoke(IPC.readCanvas, path),
  writeCanvas: (path, content) => ipcRenderer.invoke(IPC.writeCanvas, path, content),
  onVaultEvent: (listener) => {
    const wrapped = (_event: unknown, dto: VaultEventDto): void => listener(dto);
    ipcRenderer.on(IPC.vaultEvent, wrapped as never);
    return () => {
      ipcRenderer.removeListener(IPC.vaultEvent, wrapped as never);
    };
  },
};

contextBridge.exposeInMainWorld('knowledgeStudio', api);
