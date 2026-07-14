#!/usr/bin/env node
// Navigate the raw GGPK data mirror. Built for cold exploration in a fresh
// session with no prior context about the data.
//
//   npm run dat -- ls [pattern]              list/grep mirrored table names
//   npm run dat -- schema <Table>            columns + what it references / is referenced by
//   npm run dat -- grep <keyword> [--values] search table + column names (and string cells with --values)
//   npm run dat -- dump <Table> [--resolve] [--limit N] [--out file]
//                                            rows as JSON; --resolve follows foreign keys one level
//   npm run dat -- catalog                   (re)generate CATALOG.md
//
// Reads only the local mirror (data/source/ggpk-poe2/). Run `npm run fetch:dat`
// first. See docs/ggpk-datamining.md.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GGPK_DIR, TABLES_DIR, SCHEMA_PATH, loadSchema, parseTable, haveTable } from './dat.js';
import { writeCatalog, reverseRefs } from './catalog.js';

function mirroredTables() {
  if (!fs.existsSync(TABLES_DIR)) return [];
  return fs.readdirSync(TABLES_DIR)
    .filter((f) => f.endsWith('.datc64'))
    .map((f) => f.replace(/\.datc64$/, ''))
    .sort();
}

function requireMirror() {
  if (!fs.existsSync(SCHEMA_PATH) || mirroredTables().length === 0) {
    console.error('No mirror found. Run `npm run fetch:dat` first.');
    process.exit(1);
  }
}

/** display name for a table (schema casing if known). */
function displayName(schema, base) {
  return schema.byName.get(base)?.name ?? base;
}

// --- subcommands ---------------------------------------------------------

async function cmdLs(pattern) {
  requireMirror();
  const schema = await loadSchema();
  const re = pattern ? new RegExp(pattern, 'i') : null;
  const names = mirroredTables()
    .map((b) => displayName(schema, b))
    .filter((n) => !re || re.test(n));
  for (const n of names) console.log(n);
  console.error(`\n${names.length} table(s)${pattern ? ` matching /${pattern}/i` : ''}.`);
}

async function cmdSchema(name) {
  requireMirror();
  const schema = await loadSchema();
  const def = schema.byName.get(name.toLowerCase());
  if (!def) { console.error(`No dat-schema for "${name}". Try: npm run dat -- ls ${name}`); process.exit(1); }
  console.log(`# ${def.name}${haveTable(name) ? '' : '  (NOT in mirror)'}`);
  console.log('\ncolumns:');
  def.columns.forEach((c, i) => {
    const ref = c.references?.table ? ` -> ${c.references.table}` : '';
    console.log(`  ${String(i).padStart(2)}  ${(c.name || `col${i}`).padEnd(28)} ${c.type}${c.array ? '[]' : ''}${ref}`);
  });
  const refs = [...new Set(def.columns.map((c) => c.references?.table).filter(Boolean))];
  console.log(`\nreferences: ${refs.length ? refs.join(', ') : '(none)'}`);
  const rb = reverseRefs(schema).get(def.name);
  console.log(`referenced by: ${rb ? [...rb].sort().join(', ') : '(none)'}`);
}

async function cmdGrep(keyword, withValues) {
  requireMirror();
  const schema = await loadSchema();
  const kw = keyword.toLowerCase();
  const bases = mirroredTables();

  const nameHits = bases.map((b) => displayName(schema, b)).filter((n) => n.toLowerCase().includes(kw));
  if (nameHits.length) console.log(`# table names (${nameHits.length}):\n  ${nameHits.join('\n  ')}\n`);

  const colHits = [];
  for (const b of bases) {
    const def = schema.byName.get(b);
    if (!def) continue;
    for (const c of def.columns) {
      if (c.name && c.name.toLowerCase().includes(kw)) colHits.push(`${def.name}.${c.name}`);
    }
  }
  if (colHits.length) console.log(`# column names (${colHits.length}):\n  ${colHits.join('\n  ')}\n`);

  if (withValues) {
    console.error(`scanning string cells in ${bases.length} tables…`);
    const valHits = [];
    for (const b of bases) {
      if (!schema.byName.get(b)) continue;
      let parsed;
      try { parsed = await parseTable(b, { schema }); } catch { continue; }
      const strCols = parsed.columns.filter((c) => c.type.startsWith('string'));
      if (!strCols.length) continue;
      parsed.rows.forEach((row, ri) => {
        for (const c of strCols) {
          const v = row[c.name];
          const vals = Array.isArray(v) ? v : [v];
          for (const s of vals) {
            if (typeof s === 'string' && s.toLowerCase().includes(kw)) {
              valHits.push(`${parsed.name}[${ri}].${c.name} = ${JSON.stringify(s)}`);
            }
          }
        }
      });
    }
    console.log(`# string cell values (${valHits.length}):`);
    for (const h of valHits.slice(0, 200)) console.log(`  ${h}`);
    if (valHits.length > 200) console.log(`  … and ${valHits.length - 200} more`);
  } else if (!nameHits.length && !colHits.length) {
    console.log(`No table/column name matches "${keyword}". Re-run with --values to scan cell contents.`);
  }
}

// One-level foreign-key resolution: a referenced row index -> a human label
// (its Id, else first string field, else #index).
function labelForRow(row) {
  if (!row) return null;
  if (typeof row.Id === 'string') return row.Id;
  for (const k of Object.keys(row)) if (typeof row[k] === 'string' && row[k]) return row[k];
  return null;
}

async function resolveRows(parsed, schema) {
  const cache = new Map();
  const getTable = async (t) => {
    const key = t.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    let rows = null;
    try { rows = (await parseTable(key, { schema })).rows; } catch { rows = null; }
    cache.set(key, rows);
    return rows;
  };
  const refCols = parsed.columns.filter((c) => c.references);
  if (!refCols.length) return parsed.rows;
  const out = [];
  for (const row of parsed.rows) {
    const r = { ...row };
    for (const c of refCols) {
      const target = await getTable(c.references);
      if (!target) continue;
      const resolve = (idx) => (idx == null ? null : (labelForRow(target[idx]) ?? `#${idx}`));
      const v = row[c.name];
      r[c.name] = Array.isArray(v) ? v.map(resolve) : resolve(v);
    }
    out.push(r);
  }
  return out;
}

async function cmdDump(name, opts) {
  requireMirror();
  if (!haveTable(name)) { console.error(`"${name}" not in mirror. Try: npm run dat -- ls ${name}`); process.exit(1); }
  const schema = await loadSchema();
  const parsed = await parseTable(name, { schema });
  let rows = opts.resolve ? await resolveRows(parsed, schema) : parsed.rows;
  if (opts.limit != null) rows = rows.slice(0, opts.limit);
  const json = JSON.stringify(rows, null, 2);
  if (opts.out) { await fsp.writeFile(opts.out, json); console.error(`wrote ${rows.length} rows -> ${opts.out}`); }
  else console.log(json);
}

async function cmdCatalog() {
  requireMirror();
  const { out, count } = await writeCatalog();
  console.error(`wrote ${out} (${count} tables)`);
}

// --- arg parsing ---------------------------------------------------------

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'ls': return cmdLs(rest.find((a) => !a.startsWith('-')));
    case 'schema': return cmdSchema(rest[0]);
    case 'grep': return cmdGrep(rest.find((a) => !a.startsWith('-')), rest.includes('--values'));
    case 'dump':
      return cmdDump(rest.find((a) => !a.startsWith('-')), {
        resolve: rest.includes('--resolve'),
        limit: flagValue(rest, '--limit') != null ? Number(flagValue(rest, '--limit')) : null,
        out: flagValue(rest, '--out'),
      });
    case 'catalog': return cmdCatalog();
    default:
      console.error('usage: npm run dat -- <ls|schema|grep|dump|catalog> …  (see scripts/ggpk/cli.js header)');
      process.exit(cmd ? 1 : 0);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('dat:', err.message); process.exit(1); });
}
