// test/mcp/d1-adapter.js — TEST-ONLY shim: node:sqlite exposing the slice of
// the D1 client API that backends/d1.js uses. Not shipped anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SQL = path.join(ROOT, 'build', 'mcp.sql');

export async function loadSeededDb() {
  const { DatabaseSync } = await import('node:sqlite'); // throws on old Node → caller skips
  if (!fs.existsSync(SQL)) {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-mcp-sql.js')]);
  }
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(SQL, 'utf8'));
  return d1Wrap(db);
}

export function d1Wrap(db) {
  return {
    prepare(sql) {
      const run = (args) => db.prepare(sql).all(...args);
      const one = (args) => db.prepare(sql).get(...args) ?? null;
      return {
        bind(...args) {
          return {
            async all() { return { results: run(args) }; },
            async first() { return one(args); },
          };
        },
        async all() { return { results: run([]) }; },
        async first() { return one([]); },
      };
    },
  };
}
