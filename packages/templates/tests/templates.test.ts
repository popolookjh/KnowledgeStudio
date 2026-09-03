import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES, getBuiltInTemplate, renderTemplate } from '../src/index.js';

describe('renderTemplate', () => {
  const now = new Date('2026-09-04T13:14:15Z');
  it('renders all documented variables', () => {
    const result = renderTemplate('{{date}} {{time}} {{uuid}} {{filename}} {{title}}', {
      filename: 'note.md', title: 'My Note', uuid: 'fixed-id', now,
    });
    expect(result).toBe('2026-09-04 13:14:15 fixed-id note.md My Note');
  });
  it('derives title from filename when omitted', () => {
    expect(renderTemplate('{{title}}', { filename: 'میانبر.md', now })).toBe('میانبر');
  });
  it('preserves unknown variables literally', () => {
    expect(renderTemplate('{{env}} {{process.exec}} {{date}}', { filename: 'x', now })).toBe('{{env}} {{process.exec}} 2026-09-04');
  });
  it('does not execute template-looking code', () => {
    const result = renderTemplate('{{constructor.constructor("return process")()}}', { filename: 'x', now });
    expect(result).toContain('constructor');
    expect(result).not.toContain('[object process]');
  });
  it('generates a UUID when one is not supplied', () => {
    expect(renderTemplate('{{uuid}}', { filename: 'x', now })).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('built-in templates', () => {
  it('ships every requested template type as plain Markdown', () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(10);
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.content).toContain('---');
      expect(template.content).not.toContain('<script');
      expect(template.id).toBeTruthy();
    }
  });
  it('looks templates up by stable id', () => {
    expect(getBuiltInTemplate('adr')?.name).toBeUndefined();
    expect(getBuiltInTemplate('architecture-decision')?.name).toBe('Architecture Decision');
    expect(getBuiltInTemplate('missing')).toBeUndefined();
  });
});
