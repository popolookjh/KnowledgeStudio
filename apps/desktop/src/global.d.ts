/**
 * Bridge exposed by the sandboxed preload script (`electron/preload.ts`).
 * The renderer has no Node access; this flat, serializable surface is the
 * only channel to the main process. It will grow through explicit IPC
 * contracts, never through ad-hoc remote access.
 */
export {};

declare global {
  interface Window {
    readonly knowledgeStudio?: {
      readonly version: string;
      readonly platform: string;
    };
  }
}
