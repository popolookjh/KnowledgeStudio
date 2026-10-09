import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Vault } from '../packages/vault/dist/src/index.js';
import {
  collectBaseInputs,
  groupBase,
  queryBase,
  toRowView,
} from '../packages/bases/dist/src/index.js';

/**
 * Base benchmark (requires `corepack pnpm build`). For each row count it
 * writes a synthetic temp vault, then measures disk collection, query
 * (parse + filter + sort), Kanban grouping, and row projection.
 * Usage: node scripts/bases-benchmark.mjs [counts...]   (default 1000 10000)
 */
const counts = process.argv.slice(2).map(Number);
const statuses = ['todo', 'doing', 'done', 'انجام شد'];
const definition = {
  schemaVersion: 1,
  id: 'bench',
  name: 'Bench',
  view: 'kanban',
  filters: [{ field: 'status', op: 'exists' }],
  sort: { field: 'priority', direction: 'desc' },
  fields: ['status', 'priority', 'owner'],
  groupBy: 'status',
};
const results = [];
for (const count of counts.length > 0 ? counts : [1000, 10000]) {
  if (!Number.isInteger(count) || count <= 0)
    throw new Error('row counts must be positive integers');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-bases-bench-'));
  try {
    const opened = await Vault.create(root);
    if (!opened.ok) throw opened.error;
    for (let folder = 0; folder < Math.ceil(count / 500); folder += 1)
      await fs.mkdir(path.join(root, `f${folder}`));
    const writes = [];
    for (let index = 0; index < count; index += 1) {
      writes.push(
        fs.writeFile(
          path.join(root, `f${Math.floor(index / 500)}`, `note-${index}.md`),
          `---\ntitle: Note ${index}\nstatus: ${statuses[index % statuses.length]}\npriority: ${index % 97}\nowner: user${index % 13}\ntags: [bench]\n---\n# Note ${index}\n\nBody ${index}\n`,
        ),
      );
      if (writes.length >= 256) await Promise.all(writes.splice(0));
    }
    await Promise.all(writes);
    let started = performance.now();
    const inputs = await collectBaseInputs(opened.value);
    const collectMs = performance.now() - started;
    started = performance.now();
    const rows = queryBase(definition, inputs);
    const queryMs = performance.now() - started;
    started = performance.now();
    const groups = groupBase(rows, 'status');
    const groupMs = performance.now() - started;
    started = performance.now();
    const views = rows.map((row) => toRowView(row, definition.fields));
    const projectMs = performance.now() - started;
    const payloadBytes = Buffer.byteLength(JSON.stringify(views));
    opened.value.close();
    results.push({
      rows: count,
      matched: rows.length,
      groups: groups.size,
      collectMs: +collectMs.toFixed(1),
      queryMs: +queryMs.toFixed(1),
      groupMs: +groupMs.toFixed(1),
      projectMs: +projectMs.toFixed(1),
      totalMs: +(collectMs + queryMs + groupMs + projectMs).toFixed(1),
      payloadKiB: Math.round(payloadBytes / 1024),
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(results, null, 2));
