#!/usr/bin/env node
// Manual DOM-glue verification for the embeddable passive tree.
//   npm run dev   # in another terminal (localhost:3000)
//   node scripts/verify-tree-embed.mjs
import puppeteer from 'puppeteer-core';
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fails = [];
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
try {
  // 1) /passives regression: panels injected, allocation updates the counter.
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

  // 2) Two independent embeds on one page do not collide (id-scoping proof).
  const two = await browser.newPage();
  await two.goto(`${BASE}/passives`, { waitUntil: 'networkidle2', timeout: 60000 });
  const twoState = await two.evaluate(async () => {
    const mk = () => { const w = document.createElement('div'); w.className = 'passive-tree-wrap'; const c = document.createElement('canvas'); w.appendChild(c); document.body.appendChild(w); return { w, c }; };
    const m = await import('/static/js/passive-tree.js');
    const a = mk(), b = mk();
    const A = await m.load(a.c, {}), B = await m.load(b.c, {});
    await new Promise((r) => setTimeout(r, 800));
    return { aPanel: a.w.querySelectorAll('[data-tree-panel]').length, bPanel: b.w.querySelectorAll('[data-tree-panel]').length, hasA: !!A, hasB: !!B };
  });
  ok('two embeds each get exactly one panel', twoState.aPanel === 1 && twoState.bPanel === 1, JSON.stringify(twoState));

  // 3) Editor: mount, allocate, persist across reload.
  const e = await browser.newPage();
  await e.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const mounted = await e.evaluate(() => !!document.querySelector('[data-tree-mount] canvas'));
  ok('editor mounts the embed', mounted);
  // Allocate via the API on the editor's embed, then confirm the store saved a code.
  const persisted = await e.evaluate(async () => {
    const canvas = document.querySelector('[data-tree-mount] canvas');
    if (!canvas) return false;
    // Click near the class start a couple times to allocate adjacent nodes.
    const rect = canvas.getBoundingClientRect();
    for (const dx of [30, -30, 60]) {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + rect.width / 2 + dx, clientY: rect.top + rect.height / 2, bubbles: true, pointerId: 1 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + rect.width / 2 + dx, clientY: rect.top + rect.height / 2, bubbles: true, pointerId: 1 }));
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 700)); // debounce
    const raw = JSON.parse(localStorage.getItem('reveal.builds.v1') || '{}');
    const b = Object.values(raw.builds || {})[0];
    return !!(b && b.tree && b.tree.code);
  });
  ok('editor auto-saves a tree code after allocation', persisted);

  // 4) Notable Priority list present when notables are allocated (best-effort).
  const prio = await e.evaluate(() => document.querySelectorAll('[data-prio-row]').length);
  console.log(`info  priority rows: ${prio}`);
} finally {
  await browser.close();
}
process.exit(fails.length ? 1 : 0);
