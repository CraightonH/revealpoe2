import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'public/css/planner-art.css'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'docs/ui/ingame-art-inventory.md'), 'utf8');
const refs = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, '').trim());
const imgRefs = refs.filter((r) => r.includes('/static/img/'));

test('planner-art.css references at least one in-game asset', () => {
  assert.ok(imgRefs.length > 0, 'skeleton must reference real assets (the ingestion trigger)');
});

test('every planner-art.css asset is self-hosted (no hotlinking)', () => {
  for (const r of refs) {
    assert.ok(!/^https?:\/\//i.test(r), `external art ref not allowed: ${r}`);
  }
  for (const r of imgRefs) {
    assert.ok(r.startsWith('/static/img/'), `must be same-origin /static/img: ${r}`);
  }
});

test('every planner-art.css asset is documented in the catalog', () => {
  for (const r of imgRefs) {
    const dds = r.replace(/^\/static\/img\//, '').replace(/\.webp$/i, '.dds');
    assert.ok(catalog.includes(dds), `undocumented asset (add a row to docs/ui/ingame-art-inventory.md): ${dds}`);
  }
});
