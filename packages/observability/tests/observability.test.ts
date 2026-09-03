import { describe, expect, it } from 'vitest';
import { createBenchmarkNotes, measure, MemoryLogger, recoveryAction } from '../src/index.js';

describe('observability', () => {
  it('redacts secrets and never accepts note body field by API shape', () => { const log = new MemoryLogger(); log.log('info', 'vault.open', { apiKey: 'secret', path: 'vault' }); expect(log.entries()[0]?.details).toEqual({ apiKey: '[REDACTED]', path: 'vault' }); });
  it('measures success and error outcomes', async () => { let tick = 0; const clock = () => ++tick; const ok = await measure('x', () => Promise.resolve('value'), clock); expect(ok.timing).toEqual({ operation: 'x', durationMs: 1, success: true }); const failed = await measure('x', () => Promise.reject(new Error('no')), clock); expect(failed.timing.success).toBe(false); });
  it('selects non-destructive recovery actions', () => { expect(recoveryAction('SQLITE_CORRUPT')).toBe('rebuild-index'); expect(recoveryAction('EACCES')).toBe('request-permission'); expect(recoveryAction('VAULT_PATH_NOT_FOUND')).toBe('notify-external-delete'); expect(recoveryAction('OTHER')).toBe('continue'); });
  it('makes isolated synthetic benchmark fixtures', () => { const notes = createBenchmarkNotes(3); expect(notes.map((note) => note.path)).toEqual(['benchmark/note-1.md', 'benchmark/note-2.md', 'benchmark/note-3.md']); });
});
