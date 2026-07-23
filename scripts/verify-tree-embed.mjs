#!/usr/bin/env node
// Manual DOM-glue verification for the embeddable passive tree (Phase 5).
//   npm run dev   # in another terminal (localhost:3000)
//   node scripts/verify-tree-embed.mjs
//
// Node:test covers the pure cores; this covers what only a browser can: the
// embeddable init (panel injection, id-scoping), and the editor's mount +
// allocate → auto-save → Notable Priority loop. Allocation is driven by an
// AIMED click: we BFS the real (a/b) edge graph from the active class start to
// the nearest main-tree notable and synthesize a pointer click at its screen
// position (the click handler recomputes the shortest route from the node, so a
// >=2-hop notable allocates its whole path in one click).
import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fails = [];
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
try {
  // 1) /passives regression: panels injected, class selector populated.
  const p = await browser.newPage();
  await p.goto(`${BASE}/passives`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const panels = await p.evaluate(() => ({
    ctrl: !!document.querySelector('[data-tree-panel]'),
    stats: !!document.querySelector('[data-tree-stats-panel]'),
    classOpts: document.querySelector('[data-tree-class]')?.options.length || 0,
    points: document.querySelector('[data-tree-points]')?.textContent || '',
  }));
  ok('/passives injects both panels', panels.ctrl && panels.stats, JSON.stringify(panels));
  ok('/passives populates class selector', panels.classOpts > 0);

  // 2) Two independent embeds on one page do not collide (id-scoping proof) AND
  //    an AIMED click allocates → points rise, onCodeChange fires, a notable is
  //    surfaced. Exercises the full component loop deterministically.
  const two = await browser.newPage();
  await two.goto(`${BASE}/passives`, { waitUntil: 'networkidle2', timeout: 60000 });
  const comp = await two.evaluate(async () => {
    const m = await import('/static/js/passive-tree.js');
    const { worldToScreen } = m;
    const mk = (w, h) => { const el = document.createElement('div'); el.className = 'passive-tree-wrap';
      el.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px`;
      const c = document.createElement('canvas'); el.appendChild(c); document.body.appendChild(el); return { el, c }; };
    const a = mk(1000, 700), b = mk(1000, 700);
    let emitted = null;
    const A = await m.load(a.c, { root: a.el, onCodeChange: (code) => { emitted = code; } });
    const B = await m.load(b.c, { root: b.el });
    await new Promise((r) => setTimeout(r, 1400)); // fit + settle
    const { nodes, edges, meta } = A.data;
    const nodeMap = new Map(nodes.map((n) => [n.h, n]));
    const adj = new Map();
    const link = (x, y) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); };
    for (const e of edges) { link(e.a, e.b); link(e.b, e.a); }
    const start = meta.classStarts[Object.keys(meta.ascByClass)[0]];
    const q = [start], seen = new Set([start]); let target = null;
    while (q.length) {
      const cur = q.shift(), n = nodeMap.get(cur);
      if (n && cur !== start && n.asc == null && !n.hidden && (n.k === 'notable' || n.k === 'keystone')) { target = n; break; }
      for (const nb of adj.get(cur) || []) {
        const nn = nodeMap.get(nb);
        if (seen.has(nb) || !nn || nn.k === 'ascStart' || nn.asc != null) continue;
        seen.add(nb); q.push(nb);
      }
    }
    if (!target) return { err: 'no main-tree notable reachable', start };
    const rect = a.c.getBoundingClientRect();
    const sp = worldToScreen(A.view, target.x, target.y);
    const cx = rect.left + sp.x * (rect.width / a.c.width);
    const cy = rect.top + sp.y * (rect.height / a.c.height);
    const before = A.getPoints().main.spent;
    for (const t of ['pointerdown', 'pointerup']) a.c.dispatchEvent(new PointerEvent(t, { clientX: cx, clientY: cy, bubbles: true, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, 700)); // debounced onCodeChange
    return {
      aPanel: a.el.querySelectorAll('[data-tree-panel]').length,
      bPanel: b.el.querySelectorAll('[data-tree-panel]').length,
      target: target.name, before, after: A.getPoints().main.spent,
      emitted: !!emitted, notables: A.getAllocatedNotables().length,
    };
  });
  ok('two embeds each get exactly one panel', comp.aPanel === 1 && comp.bPanel === 1, JSON.stringify({ a: comp.aPanel, b: comp.bPanel }));
  ok('aimed click allocates a route (points rise)', comp.after > comp.before, JSON.stringify({ target: comp.target, before: comp.before, after: comp.after }));
  ok('allocation fires onCodeChange (auto-save signal)', comp.emitted === true);
  ok('getAllocatedNotables surfaces the notable', comp.notables > 0, `notables=${comp.notables}`);

  // 3) Editor: mount, aimed click → auto-save to the store + Notable Priority row.
  const e = await browser.newPage();
  await e.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(500);
  await e.evaluate(() => localStorage.clear());
  await e.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  await e.waitForSelector('[data-tree-mount] canvas', { timeout: 20000 }).catch(() => {});
  await sleep(1800); // embed fit + onReady
  const ed = await e.evaluate(async () => {
    const edCanvas = document.querySelector('[data-tree-mount] canvas');
    if (!edCanvas) return { err: 'no editor canvas' };
    const edRect = edCanvas.getBoundingClientRect();
    // A reference embed of the editor canvas's exact size fits identically, so a
    // node's buffer coords transfer to the editor canvas.
    const m = await import('/static/js/passive-tree.js');
    const { worldToScreen } = m;
    const ref = document.createElement('div'); ref.className = 'passive-tree-wrap';
    ref.style.cssText = `position:fixed;left:-3000px;top:0;width:${Math.round(edRect.width)}px;height:${Math.round(edRect.height)}px`;
    const rc = document.createElement('canvas'); ref.appendChild(rc); document.body.appendChild(ref);
    const R = await m.load(rc, { root: ref });
    await new Promise((r) => setTimeout(r, 1400));
    const { nodes, edges, meta } = R.data;
    const nodeMap = new Map(nodes.map((n) => [n.h, n]));
    const adj = new Map();
    const link = (x, y) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); };
    for (const eg of edges) { link(eg.a, eg.b); link(eg.b, eg.a); }
    const start = meta.classStarts[Object.keys(meta.ascByClass)[0]];
    const q = [start], seen = new Set([start]); let target = null;
    while (q.length) {
      const cur = q.shift(), n = nodeMap.get(cur);
      if (n && cur !== start && n.asc == null && !n.hidden && (n.k === 'notable' || n.k === 'keystone')) { target = n; break; }
      for (const nb of adj.get(cur) || []) { const nn = nodeMap.get(nb);
        if (seen.has(nb) || !nn || nn.k === 'ascStart' || nn.asc != null) continue; seen.add(nb); q.push(nb); }
    }
    if (!target) { ref.remove(); return { err: 'no target' }; }
    const sp = worldToScreen(R.view, target.x, target.y);
    ref.remove();
    const cx = edRect.left + sp.x * (edRect.width / edCanvas.width);
    const cy = edRect.top + sp.y * (edRect.height / edCanvas.height);
    for (const t of ['pointerdown', 'pointerup']) edCanvas.dispatchEvent(new PointerEvent(t, { clientX: cx, clientY: cy, bubbles: true, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, 900)); // debounced persist
    const raw = JSON.parse(localStorage.getItem('reveal.builds.v1') || '{}');
    const build = Object.values(raw.builds || {})[0];
    return {
      target: target.name,
      savedCode: !!(build && build.tree && build.tree.code),
      savedPriority: (build && build.tree && (build.tree.notablePriority || []).length) || 0,
      prioRows: document.querySelectorAll('[data-prio-row]').length,
    };
  });
  ok('editor mounts the embed', !ed.err, ed.err || '');
  ok('editor auto-saves the tree code after allocation', ed.savedCode === true, JSON.stringify(ed));
  ok('editor persists a Notable Priority entry', ed.savedPriority > 0, `saved=${ed.savedPriority}`);
  ok('editor renders a Notable Priority row', ed.prioRows > 0, `rows=${ed.prioRows}`);

  // 4) The embed's class/ascendancy follow the build's own selection. Seed a
  //    fresh build (no tree code) with a non-default class + ascendancy and
  //    confirm the mounted embed switched to it (its hidden class/asc selects).
  const c = await browser.newPage();
  await c.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  const want = await c.evaluate(async () => {
    const planner = await fetch('/static/generated/planner-data.json').then((r) => r.json());
    const cls = planner.classes.find((x) => x.ascendancies?.length) || planner.classes[0];
    const asc = cls.ascendancies?.[0] || null;
    const now = 1700000000000;
    const b = { id: 'sync1', schema: 2, name: 'Sync', notes: '', description: '', createdAt: now, updatedAt: now,
      class: cls.slug, ascendancy: asc ? asc.slug : null, gear: {}, unassigned: [], skills: [], tree: { code: null, notablePriority: [] } };
    localStorage.setItem('reveal.builds.v1', JSON.stringify({ order: [b.id], builds: { [b.id]: b } }));
    return { className: cls.name, ascName: asc ? asc.name : null };
  });
  await c.goto(`${BASE}/builds#/b/sync1`, { waitUntil: 'networkidle2', timeout: 60000 });
  await c.waitForSelector('[data-tree-mount] [data-tree-class]', { timeout: 20000 }).catch(() => {});
  await sleep(1600);
  const got = await c.evaluate(() => ({
    cls: document.querySelector('[data-tree-mount] [data-tree-class]')?.value || null,
    asc: document.querySelector('[data-tree-mount] [data-tree-asc]')?.selectedOptions?.[0]?.textContent || null,
  }));
  ok('embed class follows the build class on mount', got.cls === want.className, `embed=${got.cls} build=${want.className}`);
  ok('embed ascendancy follows the build ascendancy', !want.ascName || got.asc === want.ascName, `embed=${got.asc} build=${want.ascName}`);
} finally {
  await browser.close();
}
console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
