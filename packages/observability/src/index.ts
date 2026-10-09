import { createLogRecord, type LogRecord } from '@knowledge-studio/security';

/** Local structured logs. Note content is never accepted as an argument. */
export interface LocalLogger {
  log(level: LogRecord['level'], event: string, details?: Record<string, unknown>): void;
  entries(): readonly LogRecord[];
  clear(): void;
}

export class MemoryLogger implements LocalLogger {
  private readonly records: LogRecord[] = [];
  log(level: LogRecord['level'], event: string, details?: Record<string, unknown>): void {
    this.records.push(createLogRecord(level, event, details));
  }
  entries(): readonly LogRecord[] {
    return [...this.records];
  }
  clear(): void {
    this.records.length = 0;
  }
}

export interface Timing {
  readonly operation: string;
  readonly durationMs: number;
  readonly success: boolean;
}
export async function measure<T>(
  operation: string,
  task: () => Promise<T>,
  clock: () => number = () => performance.now(),
): Promise<{ value?: T; error?: unknown; timing: Timing }> {
  const start = clock();
  try {
    const value = await task();
    return { value, timing: { operation, durationMs: clock() - start, success: true } };
  } catch (error) {
    return { error, timing: { operation, durationMs: clock() - start, success: false } };
  }
}

export type RecoveryAction =
  'continue' | 'rebuild-index' | 'request-permission' | 'notify-external-delete';
export function recoveryAction(errorCode: string): RecoveryAction {
  if (errorCode === 'SQLITE_CORRUPT' || errorCode === 'INDEX_MISSING') return 'rebuild-index';
  if (errorCode === 'EACCES' || errorCode === 'EPERM') return 'request-permission';
  if (errorCode === 'VAULT_PATH_NOT_FOUND') return 'notify-external-delete';
  return 'continue';
}

/** Synthetic benchmark fixture generator; never creates user vault files. */
export function createBenchmarkNotes(
  count: number,
  prefix = 'benchmark',
): readonly { path: string; content: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `${prefix}/note-${index + 1}.md`,
    content: `# Note ${index + 1}\n\nBenchmark content ${index + 1} #performance`,
  }));
}
