/** Central command registry — foundation for palette, plugins, and AI tools. */

export type CommandPermission =
  | 'NONE'
  | 'VAULT_READ'
  | 'VAULT_WRITE'
  | 'VAULT_DELETE'
  | 'VAULT_RENAME'
  | 'INDEX_WRITE'
  | 'NETWORK'
  | 'PROCESS_EXECUTE';

export type CommandCategory = 'File' | 'Navigation' | 'Search' | 'View' | 'Workspace' | 'System';

export interface CommandContext {
  readonly vaultOpen: boolean;
  readonly activePath: string | null;
}

export interface CommandDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: CommandCategory;
  readonly shortcut?: string;
  readonly permission: CommandPermission;
  readonly keywords?: readonly string[];
  readonly execute: (context: CommandContext) => void | Promise<void>;
}

export interface CommandMatch {
  readonly command: CommandDefinition;
  readonly score: number;
}

/**
 * A deterministic, duplicate-rejecting registry. Plugins receive a scoped
 * registration handle in later phases; callers never mutate the map directly.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(command: CommandDefinition): void {
    if (!/^[a-z][a-z0-9._-]+$/.test(command.id)) {
      throw new Error(`Invalid command id: ${command.id}`);
    }
    if (this.commands.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`);
    }
    this.commands.set(command.id, command);
  }

  unregister(id: string): boolean { return this.commands.delete(id); }
  get(id: string): CommandDefinition | undefined { return this.commands.get(id); }
  list(): readonly CommandDefinition[] {
    return [...this.commands.values()].sort((a, b) => a.title.localeCompare(b.title, 'en'));
  }

  /** Fuzzy-ish token search: title/id/keywords, stable descending score. */
  search(query: string): readonly CommandMatch[] {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return this.list().map((command) => ({ command, score: 0 }));
    const matches: CommandMatch[] = [];
    for (const command of this.commands.values()) {
      const haystack = [command.title, command.id, ...(command.keywords ?? [])].join(' ').toLowerCase();
      let score = 0;
      let matched = true;
      for (const token of tokens) {
        if (!haystack.includes(token)) { matched = false; break; }
        score += command.title.toLowerCase().startsWith(token) ? 3 : haystack.startsWith(token) ? 2 : 1;
      }
      if (matched) matches.push({ command, score });
    }
    return matches.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title, 'en'));
  }

  async execute(id: string, context: CommandContext): Promise<void> {
    const command = this.commands.get(id);
    if (!command) throw new Error(`Unknown command: ${id}`);
    if (command.permission !== 'NONE' && !context.vaultOpen) {
      throw new Error(`Command requires an open vault: ${id}`);
    }
    await command.execute(context);
  }
}

export function createDefaultRegistry(handlers: Partial<Record<string, CommandDefinition['execute']>> = {}): CommandRegistry {
  const registry = new CommandRegistry();
  const register = (id: string, title: string, category: CommandCategory, permission: CommandPermission, shortcut?: string, keywords?: readonly string[]): void => {
    registry.register({ id, title, category, permission, ...(shortcut ? { shortcut } : {}), ...(keywords ? { keywords } : {}), execute: handlers[id] ?? (() => undefined) });
  };
  register('file.create-note', 'Create note', 'File', 'VAULT_WRITE', 'Ctrl+N', ['new', 'note']);
  register('file.open-note', 'Open note', 'File', 'VAULT_READ', 'Ctrl+O', ['open']);
  register('file.rename', 'Rename note', 'File', 'VAULT_RENAME');
  register('file.delete', 'Move note to trash', 'File', 'VAULT_DELETE');
  register('search.vault', 'Search vault', 'Search', 'VAULT_READ', 'Ctrl+P', ['find']);
  register('search.rebuild-index', 'Rebuild index', 'Search', 'INDEX_WRITE', undefined, ['refresh']);
  register('view.toggle-preview', 'Toggle preview', 'View', 'NONE');
  register('view.open-graph', 'Open graph', 'View', 'VAULT_READ');
  register('workspace.open-settings', 'Open settings', 'Workspace', 'NONE');
  register('system.insert-template', 'Insert template', 'System', 'VAULT_WRITE', undefined, ['template']);
  return registry;
}
