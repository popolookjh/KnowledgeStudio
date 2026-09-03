import { describe, expect, it } from 'vitest';
import { classifyLink, createLogRecord, isAcceptableFileSize, isMcpToolAllowed, isSafeExternalLink, redactSecrets } from '../src/index.js';

describe('link safety', () => {
  it('classifies local, HTTP(S), mailto and unsafe schemes', () => { expect(classifyLink('../note.md')).toBe('local-relative'); expect(classifyLink('https://example.com')).toBe('safe-external'); expect(classifyLink('mailto:a@b')).toBe('mailto'); expect(classifyLink('javascript:alert(1)')).toBe('unsafe-scheme'); });
  it('only accepts HTTP(S) as safe external links', () => { expect(isSafeExternalLink('https://example.com')).toBe(true); expect(isSafeExternalLink('file:///secret')).toBe(false); });
});

describe('log redaction', () => {
  it('redacts secret-looking keys recursively', () => { expect(redactSecrets({ apiKey: 'secret-value', nested: { password: 'pw' }, safe: 'ok' })).toEqual({ apiKey: '[REDACTED]', nested: { password: '[REDACTED]' }, safe: 'ok' }); });
  it('redacts inline secret assignments', () => { expect(redactSecrets('token=abc123 password: hunter2')).toBe('token=[REDACTED] password: [REDACTED]'); });
  it('creates structured records without note contents by default', () => { const record = createLogRecord('info', 'vault.open', { path: 'vault' }, new Date('2026-09-04T00:00:00Z')); expect(record.timestamp).toBe('2026-09-04T00:00:00.000Z'); });
});

describe('security policy', () => {
  it('allows only read-only MCP tools', () => { expect(isMcpToolAllowed('read_note')).toBe(true); expect(isMcpToolAllowed('delete')).toBe(false); expect(isMcpToolAllowed('shell')).toBe(false); });
  it('enforces attachment size limits', () => { expect(isAcceptableFileSize(100)).toBe(true); expect(isAcceptableFileSize(-1)).toBe(false); expect(isAcceptableFileSize(Infinity)).toBe(false); expect(isAcceptableFileSize(101, 100)).toBe(false); });
});
