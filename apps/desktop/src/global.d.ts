import type { BridgeApi } from '../shared/ipc-contract';

/**
 * The sandboxed preload bridge is the renderer's only privileged channel.
 * In browser/Vite dev contexts it is absent; components must treat it as
 * optional and render the welcome screen instead of crashing.
 */

declare global {
  interface Window {
    readonly knowledgeStudio?: BridgeApi;
  }
}

export {};
