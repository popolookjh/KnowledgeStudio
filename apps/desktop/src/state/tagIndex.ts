import { useSyncExternalStore } from 'react';
import { TagIndex, extractTags } from '@knowledge-studio/tags';

/** Renderer tag index: rebuildable projection of note content. */
class TagIndexService {
  private readonly index = new TagIndex();
  private readonly contents = new Map<string, string>();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): number => this.version;
  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
  rebuild(notes: readonly { path: string; content: string }[]): void {
    this.contents.clear();
    for (const note of notes) this.contents.set(note.path, note.content);
    // New instance semantics by removing known paths then readding.
    for (const path of this.index.tags().flatMap((tag) => this.index.pathsFor(tag.tag)))
      this.index.remove(path);
    for (const [path, content] of this.contents) this.index.update(path, extractTags(content));
    this.emit();
  }
  update(path: string, content: string): void {
    this.contents.set(path, content);
    this.index.update(path, extractTags(content));
    this.emit();
  }
  remove(path: string): void {
    this.contents.delete(path);
    this.index.remove(path);
    this.emit();
  }
  tags(): readonly { tag: string; count: number }[] {
    return this.index.tags();
  }
  pathsFor(tag: string): readonly string[] {
    return this.index.pathsFor(tag);
  }
}

export const tagIndex = new TagIndexService();
export function useTagIndexVersion(): number {
  return useSyncExternalStore(tagIndex.subscribe, tagIndex.getSnapshot, tagIndex.getSnapshot);
}
