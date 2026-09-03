import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings, updateSettings } from '../src/index.js';

describe('settings', () => {
  it('provides validated defaults', () => {
    expect(DEFAULT_SETTINGS.version).toBe(1);
    expect(DEFAULT_SETTINGS.appearance.theme).toBe('dark');
    expect(DEFAULT_SETTINGS.workspace.editorMode).toBe('edit');
  });
  it('falls back safely for corrupt disk JSON', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ version: 99 })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ version: 1, workspace: { explorerWidth: -2 } })).toEqual(DEFAULT_SETTINGS);
  });
  it('accepts valid state and preserves unknown-resistant shape', () => {
    const parsed = parseSettings({ version: 1, appearance: { theme: 'light', locale: 'fa' }, workspace: { openTabs: ['a.md'] } });
    expect(parsed.appearance.theme).toBe('light');
    expect(parsed.appearance.locale).toBe('fa');
    expect(parsed.workspace.openTabs).toEqual(['a.md']);
  });
  it('merges partial updates through validation', () => {
    const changed = updateSettings(DEFAULT_SETTINGS, { workspace: { ...DEFAULT_SETTINGS.workspace, editorMode: 'split' } });
    expect(changed.workspace.editorMode).toBe('split');
  });
  it('serializes stable JSON', () => {
    const serialized = serializeSettings(DEFAULT_SETTINGS);
    expect(JSON.parse(serialized)).toEqual(DEFAULT_SETTINGS);
    expect(serialized.endsWith('\n')).toBe(true);
  });
});
