#!/usr/bin/env node
// Manual DOM-glue verification for Phase 8 (sharing, variants, .build export).
//   npm run dev   # in another terminal (localhost:3000)
//   node scripts/verify-sharing-export.mjs
//   node scripts/verify-sharing-export.mjs http://localhost:4321   # against dist/
//
// node:test covers the pure cores (codec, store, build-file). This covers what
// only a browser can: the variant strip's store round trip, the group share URL
// surviving into a clean browser context, and the export click producing a
// downloadable Build object.
import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fails = [];
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
try {
  // ---- 1) variants: add two, confirm the strip and the store agree ----
  const p = await browser.newPage();
  await p.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.evaluate(() => window.localStorage.clear());
  await p.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);

  ok('editor mounts with a variant strip', await p.$('[data-variant-strip]') !== null);

  for (const n of [1, 2]) {
    await p.click('[data-variant-add]');
    await sleep(1400);
    ok(`add variant ${n} navigates to the new build`, /#\/b\//.test(p.url()), p.url());
  }
  const strip = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll('[data-variant-tab]')].map((b) => b.textContent.trim()),
    current: document.querySelector('[data-variant-tab].is-current')?.textContent.trim() ?? null,
  }));
  ok('strip shows parent + 2 variants', strip.tabs.length === 3, JSON.stringify(strip.tabs));
  ok('the newest variant is the current tab', strip.current === 'Variant 2', String(strip.current));

  const stored = await p.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('reveal.builds.v1'));
    const parent = Object.values(raw.builds).find((b) => (b.variants ?? []).length);
    return { builds: raw.order.length, schema: parent?.schema,
             labels: (parent?.variants ?? []).map((v) => v.label),
             linked: (parent?.variants ?? []).every((v) => !!raw.builds[v.buildId]) };
  });
  ok('store holds 3 builds at schema 3', stored.builds === 3 && stored.schema === 3, JSON.stringify(stored));
  ok('parent lists both labels in order', JSON.stringify(stored.labels) === '["Variant 1","Variant 2"]', JSON.stringify(stored.labels));
  ok('every variant entry points at a real build', stored.linked === true);

  // ---- 1b) label and build name are INDEPENDENT strings (2026-07-26) ----
  // A group shares one title; the label carries the phase. Editing one must
  // never move the other.
  const named = await p.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('reveal.builds.v1'));
    const parent = Object.values(raw.builds).find((b) => (b.variants ?? []).length);
    return { parentName: parent.name, childNames: parent.variants.map((v) => raw.builds[v.buildId].name) };
  });
  ok('a new variant inherits the parent title verbatim',
    named.childNames.every((n) => n === named.parentName), JSON.stringify(named));

  // Relabel the active variant tab -> only the label moves.
  await p.evaluate(() => document.querySelector('[data-variant-rename]')?.click());
  await sleep(700);
  await p.evaluate(() => {
    const i = document.querySelector('[data-variant-label-input]');
    i.value = 'Endgame';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(1200);
  const afterRelabel = await p.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('reveal.builds.v1'));
    const parent = Object.values(raw.builds).find((b) => (b.variants ?? []).length);
    const entry = parent.variants.find((v) => v.label === 'Endgame');
    return {
      label: entry?.label ?? null,
      buildName: entry ? raw.builds[entry.buildId].name : null,
      headTitle: document.querySelector('[data-build-rename]')?.textContent.replace(/✎/g, '').trim() ?? null,
      tabText: document.querySelector('[data-variant-tab].is-current')?.textContent.trim() ?? null,
    };
  });
  ok('relabelling a variant sets the label', afterRelabel.label === 'Endgame', JSON.stringify(afterRelabel));
  ok('relabelling leaves the build title untouched', afterRelabel.buildName === named.parentName,
    `title is now ${afterRelabel.buildName}, expected ${named.parentName}`);
  ok('the tab shows the label, the head shows the title',
    afterRelabel.tabText === 'Endgame' && afterRelabel.headTitle === named.parentName,
    `tab=${afterRelabel.tabText} head=${afterRelabel.headTitle}`);

  // Rename the BUILD -> only the title moves, label stays 'Endgame'.
  await p.evaluate(() => document.querySelector('[data-build-rename]').click());
  await sleep(700);
  await p.evaluate(() => {
    const i = document.querySelector('[data-build-name-input]');
    i.value = 'Stormweaver CoC';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(1200);
  const afterRename = await p.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('reveal.builds.v1'));
    const parent = Object.values(raw.builds).find((b) => (b.variants ?? []).length);
    const entry = parent.variants.find((v) => v.label === 'Endgame');
    return { label: entry?.label ?? null, buildName: entry ? raw.builds[entry.buildId].name : null,
             tabText: document.querySelector('[data-variant-tab].is-current')?.textContent.trim() ?? null };
  });
  ok('renaming the build sets its title', afterRename.buildName === 'Stormweaver CoC', JSON.stringify(afterRename));
  ok('renaming the build leaves the label untouched', afterRename.label === 'Endgame',
    `label is now ${afterRename.label}`);
  ok('the tab still shows the label after a rename', afterRename.tabText === 'Endgame', String(afterRename.tabText));

  // switch back to the parent by clicking its tab
  await p.evaluate(() => document.querySelector('[data-variant-tab]').click());
  await sleep(1400);
  ok('clicking the parent tab navigates', /#\/b\//.test(p.url()));

  // ---- 2) group share: encode here, decode in a fresh context ----
  const code = await p.evaluate(async () => {
    const { encodeGroup } = await import('/static/js/build-code.js');
    const { getStore } = await import('/static/js/build-host.js');
    const store = getStore();
    const parent = store.list().find((b) => (b.variants ?? []).length);
    return encodeGroup(store.group(parent.id));
  });
  ok('group encodes to a v2 code', typeof code === 'string' && code[0] === '2', `len ${code?.length}`);
  ok('code is fragment-safe', /^[A-Za-z0-9_-]+$/.test(code));

  const clean = await browser.createBrowserContext();
  const q = await clean.newPage();
  await q.goto(`${BASE}/builds#/import/${code}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2400);
  const shared = await q.evaluate(() => ({
    banner: document.querySelector('.dossier-banner')?.textContent.trim() ?? null,
    tabs: [...document.querySelectorAll('[data-variant-tab]')].map((b) => b.textContent.trim()),
    canAdd: !!document.querySelector('[data-variant-add]'),
    canSave: !!document.querySelector('[data-import-save]'),
    stored: window.localStorage.getItem('reveal.builds.v1'),
  }));
  ok('shared group renders read-only with tabs', shared.tabs.length === 3, JSON.stringify(shared.tabs));
  ok('banner announces the variants', /variant/i.test(shared.banner ?? ''), shared.banner);
  ok('a visitor cannot add variants', shared.canAdd === false);
  ok('a visitor is offered Save a copy', shared.canSave === true);
  ok('view-first: nothing was written to storage', shared.stored === null, String(shared.stored));

  // switching tabs must not persist anything either
  await q.evaluate(() => document.querySelectorAll('[data-variant-tab]')[2].click());
  await sleep(1000);
  const afterSwitch = await q.evaluate(() => ({
    current: document.querySelector('[data-variant-tab].is-current')?.textContent.trim() ?? null,
    stored: window.localStorage.getItem('reveal.builds.v1'),
  }));
  // 'Endgame' — the third tab was relabelled in step 1b, and that label travels
  // in the share code, which is itself proof the label round-trips.
  ok('shared tabs switch the previewed snapshot', afterSwitch.current === 'Endgame', String(afterSwitch.current));
  ok('switching still writes nothing', afterSwitch.stored === null);

  // save a copy imports the WHOLE group
  await q.click('[data-import-save]');
  await sleep(1800);
  const imported = await q.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('reveal.builds.v1'));
    const parent = Object.values(raw.builds).find((b) => (b.variants ?? []).length);
    return { builds: raw.order.length, variants: (parent?.variants ?? []).length,
             linked: (parent?.variants ?? []).every((v) => !!raw.builds[v.buildId]) };
  });
  ok('save-a-copy imports parent + variants', imported.builds === 3 && imported.variants === 2, JSON.stringify(imported));
  ok('imported group is relinked to local ids', imported.linked === true);

  // ---- 3) a damaged code fails friendly, not blank ----
  const bad = await clean.newPage();
  await bad.goto(`${BASE}/builds#/import/2notarealcode`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1800);
  const errText = await bad.evaluate(() => document.body.textContent ?? '');
  ok('a damaged code shows a friendly error', /didn|damaged|incomplete/i.test(errText));

  // ---- 4) export: the click produces a real Build object ----
  const file = await p.evaluate(async () => {
    const [{ buildToBuildFile, buildFileName }, { loadBuildExport, getStore }, { grantedRows }] = await Promise.all([
      import('/static/js/build-file.js'),
      import('/static/js/build-host.js'),
      import('/static/js/editor-render.js'),
    ]);
    const planner = await fetch('/static/generated/planner-data.json').then((r) => r.json());
    const pools = await fetch('/static/generated/mod-pools.json').then((r) => r.json());
    const ids = await loadBuildExport();
    const b = getStore().list()[0];
    return {
      name: buildFileName(b.name),
      out: buildToBuildFile(b, { ids, pools, resolveRef: () => null, grantedRows: (x) => grantedRows(x, planner) }),
      idCounts: { gems: Object.keys(ids.gemIds).length, passives: Object.keys(ids.passiveIds).length,
                  asc: Object.keys(ids.ascendancyIds).length },
    };
  });
  ok('export id artifacts both load', file.idCounts.gems > 900 && file.idCounts.passives > 5000, JSON.stringify(file.idCounts));
  ok('exported object has the required root keys',
    ['name', 'passives', 'skills', 'inventory_slots'].every((k) => k in file.out), JSON.stringify(Object.keys(file.out)));
  ok('exported filename ends in .build', /\.build$/.test(file.name), file.name);

  const btn = await p.$('[data-export-build]');
  ok('the editor exposes an Export for game action', btn !== null);
  if (btn) {
    await btn.click();
    await sleep(1800);
    const note = await p.evaluate(() => {
      const n = document.querySelector('[data-export-note]');
      return { hidden: n?.hidden, text: n?.textContent.trim() ?? '' };
    });
    ok('export click surfaces the placement note', note.hidden === false && /BuildPlanner/.test(note.text), note.text);
  }
} finally {
  await browser.close();
}

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
