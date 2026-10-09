import { describe, expect, it } from 'vitest';
import { detectDirection, LOCALES, presentationForNote, segmentDirections } from '../src/index.js';

describe('RTL/Persian helpers', () => {
  it('detects Persian RTL, English LTR, and mixed content', () => {
    expect(detectDirection('سلام دنیا')).toBe('rtl');
    expect(detectDirection('hello world')).toBe('ltr');
    expect(detectDirection('سلام hello')).toBe('auto');
  });
  it('keeps code blocks LTR in RTL notes', () => {
    const segments = segmentDirections('متن فارسی\n```ts\nconst x = 1;\n```\nادامه');
    expect(
      segments.some((segment) => segment.direction === 'ltr' && segment.text.includes('const x')),
    ).toBe(true);
  });
  it('strips frontmatter only for presentation, not source mutation', () => {
    const note = '---\ntitle: تست\n---\nسلام';
    const view = presentationForNote(note);
    expect(view.hasFrontmatter).toBe(true);
    expect(view.body).toBe('سلام');
    expect(view.direction).toBe('rtl');
  });
  it('offers English and Persian locale metadata', () => {
    expect(LOCALES.fa.direction).toBe('rtl');
    expect(LOCALES.en.direction).toBe('ltr');
  });
});
