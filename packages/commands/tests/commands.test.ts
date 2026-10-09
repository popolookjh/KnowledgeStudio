import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, createDefaultRegistry } from '../src/index.js';

describe('CommandRegistry', () => {
  it('registers, looks up, lists, and unregisters commands', () => {
    const registry = new CommandRegistry();
    const execute = vi.fn();
    registry.register({
      id: 'test.action',
      title: 'Test action',
      category: 'System',
      permission: 'NONE',
      execute,
    });
    expect(registry.get('test.action')?.title).toBe('Test action');
    expect(registry.list()).toHaveLength(1);
    expect(registry.unregister('test.action')).toBe(true);
    expect(registry.get('test.action')).toBeUndefined();
  });
  it('rejects invalid and duplicate ids', () => {
    const registry = new CommandRegistry();
    const command = {
      id: 'test.action',
      title: 'Test',
      category: 'System' as const,
      permission: 'NONE' as const,
      execute: () => undefined,
    };
    expect(() => registry.register({ ...command, id: 'Invalid ID' })).toThrow(/Invalid/);
    registry.register(command);
    expect(() => registry.register(command)).toThrow(/already/);
  });
  it('ranks fuzzy matches by title prefix', () => {
    const registry = createDefaultRegistry();
    const matches = registry.search('note');
    expect(matches[0]?.command.id).toBe('file.create-note');
    expect(matches.some((match) => match.command.id === 'file.open-note')).toBe(true);
  });
  it('returns all commands for blank query', () => {
    expect(createDefaultRegistry().search('')).toHaveLength(10);
  });
  it('executes handlers and guards vault permissions', async () => {
    const execute = vi.fn();
    const registry = createDefaultRegistry({ 'file.create-note': execute });
    await registry.execute('file.create-note', { vaultOpen: true, activePath: null });
    expect(execute).toHaveBeenCalledOnce();
    await expect(
      registry.execute('file.create-note', { vaultOpen: false, activePath: null }),
    ).rejects.toThrow(/open vault/);
  });
  it('includes the requested built-in commands', () => {
    const ids = createDefaultRegistry()
      .list()
      .map((command) => command.id);
    expect(ids).toContain('search.rebuild-index');
    expect(ids).toContain('view.open-graph');
    expect(ids).toContain('system.insert-template');
  });
});
