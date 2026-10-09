/**
 * Base class for the Knowledge Studio error taxonomy.
 *
 * Every error carries a stable machine-readable `code` so callers (UI,
 * plugins, MCP) can branch on behavior without matching message strings.
 * Messages are for humans and may change; codes are API.
 */
export class StudioError extends Error {
  /** Stable identifier, e.g. `VAULT_PATH_INVALID`. */
  readonly code: string;
  /** Structured context for logs and diagnostics. Never includes note content. */
  readonly details?: unknown;

  constructor(code: string, message: string, options?: { details?: unknown; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}
