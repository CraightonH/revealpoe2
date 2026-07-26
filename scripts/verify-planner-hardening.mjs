import puppeteer from 'puppeteer-core';
// Adversarial input hardening for the Build Planner (2026-07-26).
//   npm run dev   # in another terminal
//   node scripts/verify-planner-hardening.mjs
//
// Forges a deliberately hostile share code — megabyte title, 5000 skill setups,
// 10k fake gear slots, 100k notable priorities, novel-length notes — and asserts
// the page renders, stays inside the viewport, tells the visitor it was trimmed,
// and stores bounded data. The codec has no size opinion by design, so clampBuild
// is the only thing standing between a shared URL and a broken page.
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fails=[]; const ok=(n,c,d)=>{console.log(`${c?'ok  ':'FAIL'} ${n}${d?' — '+d:''}`); if(!c)fails.push(n);};
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
const p = await b.newPage();
p.on('dialog', async d => { p._dlg = d.message(); await d.dismiss(); });
await p.goto('http://localhost:3000/builds', { waitUntil: 'networkidle2', timeout: 60000 });
await p.evaluate(() => window.localStorage.clear());
await p.goto('http://localhost:3000/builds', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r=>setTimeout(r,2500));

// Forge a deliberately hostile group code: megabyte title, 5000 setups, 10k fake
// gear slots, 100k notable priorities, novel-length notes.
const code = await p.evaluate(async () => {
  const { encodeGroup } = await import('/static/js/build-code.js');
  const x = (n) => 'x'.repeat(n);
  const nasty = () => ({
    schema: 3, name: x(200000), description: x(200000), notes: x(1000000),
    class: null, ascendancy: null,
    gear: Object.fromEntries(Array.from({length:10000},(_,i)=>[`fake${i}`,
      { item:{kind:'base',slug:'x'}, mods:Array.from({length:100},(_,j)=>({affix:'a'+j,tier:'t'})), corrupted:null }])),
    unassigned: Array.from({length:5000},(_,i)=>({kind:'gem',slug:'g'+i})),
    skills: Array.from({length:5000},(_,i)=>({gem:{slug:'g'+i},level:null,
      supports:Array.from({length:200},(_,j)=>({slug:'s'+j}))})),
    tree: { code: x(500000), notablePriority: Array.from({length:100000},(_,i)=>i) },
    variants: [],
  });
  return encodeGroup({ parent: nasty(), variants: [{ label: x(5000), build: nasty() }] });
});
ok('hostile group encodes (the codec has no size opinion)', typeof code === 'string', `${(code.length/1024).toFixed(0)} KB code`);

const clean = await b.createBrowserContext();
const q = await clean.newPage();
await q.setViewport({ width: 1400, height: 900 });
const t0 = Date.now();
await q.goto(`http://localhost:3000/builds#/import/${code}`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r=>setTimeout(r,3000));
const elapsed = Date.now() - t0;

const view = await q.evaluate(() => ({
  rendered: !!document.querySelector('[data-editor]'),
  warned: !!document.querySelector('.dossier-banner--warn'),
  warnText: document.querySelector('.dossier-banner--warn')?.textContent.slice(0, 140) ?? null,
  titleLen: (document.querySelector('.dossier-name--static, [data-build-rename]')?.textContent ?? '').trim().length,
  setups: document.querySelectorAll('.editor-chains > li').length,
  tabLabelLen: (document.querySelector('[data-variant-tab]:not(:first-child)')?.textContent ?? '').trim().length,
  scrollW: document.documentElement.scrollWidth,
  vw: window.innerWidth,
  bodyWide: document.documentElement.scrollWidth > window.innerWidth + 4,
  stored: window.localStorage.getItem('reveal.builds.v1'),
}));
ok('the page still rendered', view.rendered === true);
ok('it loaded without hanging', elapsed < 25000, `${elapsed}ms`);
ok('the visitor is told it was trimmed', view.warned === true, view.warnText);
ok('title is clamped, not a megabyte', view.titleLen > 0 && view.titleLen <= 62, String(view.titleLen));
ok('skill rows are bounded', view.setups > 0 && view.setups <= 24, String(view.setups));
ok('variant label is clamped', view.tabLabelLen <= 42, String(view.tabLabelLen));
ok('no horizontal page overflow', view.bodyWide === false, `scrollWidth ${view.scrollW} vs viewport ${view.vw}`);
ok('view-first still holds (nothing stored)', view.stored === null);

// Copy: the store must clamp independently of the display clamp.
await q.click('[data-import-save]');
await new Promise(r=>setTimeout(r,3000));
const saved = await q.evaluate(() => {
  const raw = JSON.parse(window.localStorage.getItem('reveal.builds.v1'));
  const all = Object.values(raw.builds);
  const worst = (f) => Math.max(...all.map(b => (b[f] ?? '').length ?? 0));
  return { count: all.length, chars: window.localStorage.getItem('reveal.builds.v1').length,
    maxName: worst('name'), maxNotes: worst('notes'),
    maxSetups: Math.max(...all.map(b => b.skills.length)),
    maxGear: Math.max(...all.map(b => Object.keys(b.gear).length)),
    maxTray: Math.max(...all.map(b => b.unassigned.length)),
    maxPrio: Math.max(...all.map(b => b.tree.notablePriority.length)) };
});
ok('the group imported into a clean origin', saved.count === 2, JSON.stringify({count:saved.count}));
ok('stored size is sane, not megabytes', saved.chars < 200000, `${(saved.chars/1024).toFixed(0)} KB`);
ok('name clamped in the store', saved.maxName <= 60, String(saved.maxName));
ok('notes clamped in the store', saved.maxNotes <= 10000, String(saved.maxNotes));
ok('setups clamped in the store', saved.maxSetups <= 24, String(saved.maxSetups));
ok('gear slots clamped in the store', saved.maxGear <= 24, String(saved.maxGear));
ok('tray clamped in the store', saved.maxTray <= 100, String(saved.maxTray));
ok('notable priority clamped', saved.maxPrio <= 200, String(saved.maxPrio));

// Editor still usable afterwards, and the setup ceiling holds in the UI.
const usable = await q.evaluate(() => ({
  editor: !!document.querySelector('[data-editor]'),
  addDisabled: document.querySelector('[data-setup-add]')?.disabled ?? null,
}));
ok('the editor is still usable on the imported build', usable.editor === true);
ok('add-skill-setup is disabled at the ceiling', usable.addDisabled === true, String(usable.addDisabled));

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
