import { describe, expect, it } from 'vitest';
import { groupBase, queryBase, type BaseDefinition } from '../src/index.js';
const definition: BaseDefinition = {
  schemaVersion: 1,
  id: 'projects',
  name: 'پروژه‌ها',
  view: 'table',
  filters: [{ field: 'status', op: 'equals', value: 'open' }],
  sort: { field: 'title', direction: 'asc' },
  fields: ['status', 'tags'],
  groupBy: 'status',
};
describe('bases', () => {
  it('filters Persian metadata and sorts deterministically without body rows', () => {
    const rows = queryBase(definition, [
      { path: 'b.md', content: '---\ntitle: بتا\nstatus: open\ntags: [تحقیق]\n---\nbody' },
      { path: 'a.md', content: '---\ntitle: آلفا\nstatus: open\n---\nbody' },
      { path: 'closed.md', content: '---\nstatus: closed\n---\n' },
    ]);
    expect(rows.map((r) => r.path)).toEqual(['a.md', 'b.md']);
    expect(groupBase(rows, 'status').get('open')).toHaveLength(2);
  });
});
describe('bases performance guard', () => {
  it('queries and groups 10k in-memory rows within budget', () => {
    const inputs = Array.from({ length: 10_000 }, (_unused, index) => ({
      path: `n/${index}.md`,
      content: `---\ntitle: N${index}\nstatus: s${index % 5}\npriority: ${index % 97}\n---\n`,
      mtimeMs: index,
    }));
    const started = performance.now();
    const rows = queryBase(
      {
        schemaVersion: 1,
        id: 'bench',
        name: 'Bench',
        view: 'kanban',
        filters: [{ field: 'status', op: 'exists' }],
        sort: { field: 'priority', direction: 'desc' },
        fields: ['status'],
        groupBy: 'status',
      },
      inputs,
    );
    const grouped = groupBase(rows, 'status');
    expect(rows).toHaveLength(10_000);
    expect(grouped.size).toBe(5);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
