import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeApi, VaultEventDto } from '../shared/ipc-contract.js';

/**
 * CJS preload cannot require the renderer's ESM contract output under the
 * desktop package's `type: module`. Keep this runtime-only mirror local to
 * the preload; BridgeApi remains imported as a type so its public surface is
 * still checked against the shared IPC contract at compile time.
 */
const IPC = {
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
  basesList: 'bases:list',
  basesSave: 'bases:save',
  basesDelete: 'bases:delete',
  basesQuery: 'bases:query',
  basesSetField: 'bases:set-field',
} as const;

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
  listHistory: (notePath) => ipcRenderer.invoke(IPC.historyList, notePath),
  readHistory: (notePath, revisionId) => ipcRenderer.invoke(IPC.historyRead, notePath, revisionId),
  gitStatus: () => ipcRenderer.invoke(IPC.gitStatus),
  gitDiff: (paths) => ipcRenderer.invoke(IPC.gitDiff, paths),
  gitCommitSelected: (paths, message) => ipcRenderer.invoke(IPC.gitCommitSelected, paths, message),
  mcpStatus: () => ipcRenderer.invoke(IPC.mcpStatus),
  mcpStart: (port) => ipcRenderer.invoke(IPC.mcpStart, port),
  mcpStop: () => ipcRenderer.invoke(IPC.mcpStop),
  listPlugins: () => ipcRenderer.invoke(IPC.pluginList),
  setPluginEnabled: (pluginId, enabled) => ipcRenderer.invoke(IPC.pluginSetEnabled, pluginId, enabled),
  approvePluginHighRisk: (pluginId, permission, approved) => ipcRenderer.invoke(IPC.pluginApproveHighRisk, pluginId, permission, approved),
  aiConfigList: () => ipcRenderer.invoke(IPC.aiConfigList),
  aiConfigUpsert: (config) => ipcRenderer.invoke(IPC.aiConfigUpsert, config),
  aiConfigSetSecret: (providerId, secret) => ipcRenderer.invoke(IPC.aiConfigSetSecret, providerId, secret),
  aiConfigRemoveSecret: (providerId) => ipcRenderer.invoke(IPC.aiConfigRemoveSecret, providerId),
  pickAttachment: (notePath) => ipcRenderer.invoke(IPC.attachmentPick, notePath),
  attachmentIssues: (notePath) => ipcRenderer.invoke(IPC.attachmentIssues, notePath),
  basesList: () => ipcRenderer.invoke(IPC.basesList),
  basesSave: (definition, expectedRevision) => ipcRenderer.invoke(IPC.basesSave, definition, expectedRevision),
  basesDelete: (id, expectedRevision) => ipcRenderer.invoke(IPC.basesDelete, id, expectedRevision),
  basesQuery: (id) => ipcRenderer.invoke(IPC.basesQuery, id),
  basesSetField: (edit) => ipcRenderer.invoke(IPC.basesSetField, edit),
  onVaultEvent: (listener) => {
    const wrapped = (_event: unknown, dto: VaultEventDto): void => listener(dto);
    ipcRenderer.on(IPC.vaultEvent, wrapped as never);
    return () => {
      ipcRenderer.removeListener(IPC.vaultEvent, wrapped as never);
    };
  },
};

contextBridge.exposeInMainWorld('knowledgeStudio', api);
