import { extractOutgoingLinks } from '@knowledge-studio/links';
import { readMetadata } from '@knowledge-studio/metadata';
import type { McpDataSource, NoteRecord } from '@knowledge-studio/mcp';
import { extractTags } from '@knowledge-studio/tags';
import { walkVault, type Vault } from '@knowledge-studio/vault';

/** Active-vault read-only adapter for the MCP host. */
export function createVaultMcpDataSource(vault: Vault): McpDataSource {
  const notes = async (): Promise<readonly NoteRecord[]> => {
    const entries = await walkVault(vault.root);
    if (!entries.ok) return [];
    const records: NoteRecord[] = [];
    for (const entry of entries.value) {
      if (entry.kind !== 'note') continue;
      const read = await vault.readFile(entry.path);
      if (read.ok) records.push({ path: entry.path, content: read.value.content, metadata: readMetadata(read.value.content).data });
    }
    return records;
  };
  return {
    async searchNotes(query) {
      const needle = query.toLocaleLowerCase();
      return (await notes()).filter((note) => note.path.toLocaleLowerCase().includes(needle) || note.content.toLocaleLowerCase().includes(needle));
    },
    async readNote(notePath) {
      const read = await vault.readFile(notePath);
      return read.ok ? { path: notePath, content: read.value.content, metadata: readMetadata(read.value.content).data } : null;
    },
    async listNotes() { return notes(); },
    async getMetadata(notePath) {
      const read = await vault.readFile(notePath);
      return read.ok ? readMetadata(read.value.content).data : null;
    },
    async getBacklinks(notePath) {
      const result: string[] = [];
      for (const note of await notes()) {
        if (extractOutgoingLinks(note.content).wiki.some((link) => link.target === notePath || `${link.target}.md` === notePath)) result.push(note.path);
      }
      return result;
    },
    async getOutgoingLinks(notePath) {
      const read = await vault.readFile(notePath);
      if (!read.ok) return [];
      const outgoing = extractOutgoingLinks(read.value.content);
      return [...outgoing.wiki.map((link) => link.target), ...outgoing.markdown.map((link) => link.href)];
    },
    async searchTags(tag) {
      const needle = tag.replace(/^#/, '').toLocaleLowerCase();
      return (await notes()).filter((note) => extractTags(note.content).some((entry) => entry.tag === needle)).map((note) => note.path);
    },
  };
}
