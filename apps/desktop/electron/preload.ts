import { contextBridge } from 'electron';

/**
 * Preload bridge. Runs with `sandbox: true`, so no Node APIs are available
 * here beyond what Electron explicitly allows. Only flat, serializable
 * data is exposed to the renderer.
 */
contextBridge.exposeInMainWorld('knowledgeStudio', {
  version: process.env['npm_package_version'] ?? '0.0.0',
  platform: process.platform,
});
