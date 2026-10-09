import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const noteCount = Number(process.argv[2] ?? '1000');
if (!Number.isInteger(noteCount) || noteCount <= 0)
  throw new Error('note count must be a positive integer');
const db = new DatabaseSync(':memory:');
db.exec(
  "CREATE VIRTUAL TABLE notes USING fts5(path, body, tokenize='unicode61 remove_diacritics 2')",
);
const insert = db.prepare('INSERT INTO notes(path, body) VALUES(?, ?)');
const start = performance.now();
for (let index = 0; index < noteCount; index += 1)
  insert.run(
    `bench/note-${index}.md`,
    `# Note ${index}\nBenchmark performance content #tag${index % 10}`,
  );
const indexMs = performance.now() - start;
const queryStart = performance.now();
const matches = db
  .prepare("SELECT count(*) AS count FROM notes WHERE notes MATCH 'Benchmark*'")
  .get();
const queryMs = performance.now() - queryStart;
console.log(
  JSON.stringify({
    noteCount,
    indexMs: Number(indexMs.toFixed(2)),
    queryMs: Number(queryMs.toFixed(2)),
    matches: matches.count,
  }),
);
db.close();
