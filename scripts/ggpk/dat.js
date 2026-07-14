// Pure .datc64 decoder: a cached raw table + the pinned dat-schema -> JSON rows.
//
// This is the ONE place .datc64 decoding lives. No network: it reads the mirror
// produced by scripts/fetch-ggpk-dat.js (data/source/ggpk-poe2/) and the pinned
// community column definitions (schema.min.json from poe-tool-dev/dat-schema).
//
// .datc64 rows are positional fixed-width binary with NO embedded column names;
// dat-schema supplies the ordered (name,type) list per table so we can walk each
// row. Column *order* is load-bearing — a wrong/partial schema misaligns every
// column after the bad one (visible as garbage in `dat dump`).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const GGPK_DIR = path.join(root, 'data', 'source', 'ggpk-poe2');
export const TABLES_DIR = path.join(GGPK_DIR, 'tables');
export const SCHEMA_PATH = path.join(GGPK_DIR, 'schema.min.json');

// pathofexile-dat's `dat.js` barrel eagerly imports a browser-oriented wasm
// analysis module that throws under Node. We only need the pure parser
// submodules, but the package `exports` map blocks subpath imports (even
// package.json). `./dat.js` IS exported, so resolve it, then import its sibling
// dist/dat/*.js files by file URL (drive-letter / backslash safe on any OS).
let _reader;
async function reader() {
  if (_reader) return _reader;
  const dat = path.join(path.dirname(require.resolve('pathofexile-dat/dat.js')), 'dat');
  const [datFile, header, rd] = await Promise.all([
    import(pathToFileURL(path.join(dat, 'dat-file.js')).href),
    import(pathToFileURL(path.join(dat, 'header.js')).href),
    import(pathToFileURL(path.join(dat, 'reader.js')).href),
  ]);
  _reader = {
    readDatFile: datFile.readDatFile,
    getHeaderLength: header.getHeaderLength,
    readColumn: rd.readColumn,
  };
  return _reader;
}

// dat-schema column type -> pathofexile-dat header `type`. Arrays are a fixed
// 16-byte pointer regardless of element type, so offset accumulation is correct
// even when the inner type is unknown; only element *reading* needs it.
function headerType(col) {
  const t = {};
  if (col.array) t.array = true;
  switch (col.type) {
    case 'bool': t.boolean = {}; break;
    case 'string': t.string = {}; break;
    case 'i16': t.integer = { unsigned: false, size: 2 }; break;
    case 'i32': t.integer = { unsigned: false, size: 4 }; break;
    case 'u16': t.integer = { unsigned: true, size: 2 }; break;
    case 'u32': case 'enumrow': t.integer = { unsigned: true, size: 4 }; break;
    case 'f32': t.decimal = { size: 4 }; break;
    case 'row': t.key = { foreign: false }; break;
    case 'foreignrow': t.key = { foreign: true }; break;
    case 'array': break; // untyped array: pointer only, elements unreadable
    default: throw new Error(`unknown dat-schema column type: ${col.type}`);
  }
  return t;
}

let _schema;
/** Load + index the pinned dat-schema. Tables keyed by lowercase name. */
export async function loadSchema(schemaPath = SCHEMA_PATH) {
  if (_schema && _schema._path === schemaPath) return _schema;
  const raw = JSON.parse(await fsp.readFile(schemaPath, 'utf8'));
  const byName = new Map();
  for (const t of raw.tables) byName.set(t.name.toLowerCase(), t);
  _schema = { _path: schemaPath, raw, byName };
  return _schema;
}

export function tablePath(name, dir = TABLES_DIR) {
  return path.join(dir, `${name.toLowerCase()}.datc64`);
}

/** True if the raw table has been mirrored locally. */
export function haveTable(name, dir = TABLES_DIR) {
  return fs.existsSync(tablePath(name, dir));
}

/**
 * Parse a table into JSON rows.
 * @returns {{name,rowCount,rowLength,columns,rows}} — columns is the ordered
 *   schema column list; rows are objects keyed by column name (or `col<i>` for
 *   anonymous columns). Undecodable columns yield null (never throw the row).
 */
export async function parseTable(name, { schema, bytes, dir = TABLES_DIR } = {}) {
  const sch = schema ?? (await loadSchema());
  const def = sch.byName.get(name.toLowerCase());
  if (!def) throw new Error(`no dat-schema for table "${name}"`);
  const buf = bytes ?? (await fsp.readFile(tablePath(name, dir)));
  const { readDatFile, getHeaderLength, readColumn } = await reader();
  const df = readDatFile('.datc64', buf);

  let offset = 0;
  const columns = def.columns.map((c, i) => ({
    name: c.name || `col${i}`,
    type: c.type + (c.array ? '[]' : ''),
    references: c.references?.table ?? null,
  }));
  const readers = def.columns.map((c) => {
    const header = { offset, type: headerType(c) };
    offset += getHeaderLength(header, df);
    // Untyped arrays (and anything readColumn chokes on) become null rather
    // than corrupting the whole dump — offsets are already fixed above.
    let col = null;
    try { col = readColumn(header, df); } catch { col = null; }
    return col;
  });

  const rows = [];
  for (let i = 0; i < df.rowCount; i++) {
    const row = {};
    columns.forEach((c, j) => { row[c.name] = readers[j] ? readers[j][i] : null; });
    rows.push(row);
  }
  return { name: def.name, rowCount: df.rowCount, rowLength: df.rowLength, columns, rows };
}
