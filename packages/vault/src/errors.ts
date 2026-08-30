import { StudioError } from '@knowledge-studio/shared';

/**
 * Error taxonomy for vault operations. Codes are stable API; `details` carries
 * structured context (never note content).
 */
export type VaultErrorCode =
  | 'VAULT_ROOT_INVALID'
  | 'VAULT_ROOT_NOT_EMPTY_FILE_CONFLICT'
  | 'VAULT_NOT_OPEN'
  | 'VAULT_PATH_NOT_FOUND'
  | 'VAULT_PATH_EXISTS'
  | 'VAULT_PATH_IS_DIRECTORY'
  | 'VAULT_PATH_IS_FILE'
  | 'VAULT_ESCAPE_BLOCKED'
  | 'VAULT_MODIFIED_SINCE_READ'
  | 'VAULT_READ_FAILED'
  | 'VAULT_WRITE_FAILED'
  | 'VAULT_RENAME_FAILED'
  | 'VAULT_DELETE_FAILED'
  | 'VAULT_RESTORE_CONFLICT'
  | 'VAULT_TRASH_ENTRY_NOT_FOUND'
  | 'VAULT_WATCH_FAILED'
  | 'VAULT_APP_DIR_LOCKED'
  | 'VAULT_EMPTY_PATH';

export class VaultError extends StudioError {
  constructor(
    code: VaultErrorCode,
    message: string,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(code, message, options);
  }
}
