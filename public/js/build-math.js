// Pure light-math core for the build planner (Phase 7). Parses a whitelisted
// set of stat lines and sums them; NO DPS/damage/defence math. Imported by BOTH
// the Node build step (src/data/itemMath.js, over real source) and the browser
// editor (dynamic chosen-mods + live passive tree), so parsing can't diverge.

// [id|display] -> display (repoe markup), then collapse whitespace.
export function stripStatMarkup(line) {
  return String(line ?? '')
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, (_, id, disp) => disp || id)
    .replace(/\[([^\]]*)\]/g, (_, t) => t)
    .replace(/\s+/g, ' ')
    .trim();
}

const ATTR_NAME = { Strength: 'str', Dexterity: 'dex', Intelligence: 'int' };
const RES_NAME = { Fire: 'fireRes', Cold: 'coldRes', Lightning: 'lightRes', Chaos: 'chaosRes' };
// A number token: optional +, optional (a-b) range, e.g. "+(10-15)", "8", "-5".
const N = String.raw`\+?\(?(-?\d+)(?:-(-?\d+))?\)?`;
const FLAT = new RegExp(`^${N} to (Strength|Dexterity|Intelligence|all Attributes|maximum Life|maximum Mana|Spirit)$`);
const RES = new RegExp(`^${N}% to (Fire|Cold|Lightning|Chaos) Resistance$`);
const ALL_ELE = new RegExp(`^${N}% to all Elemental Resistances$`);

function range(lo, hi) { const a = Number(lo); const b = hi == null ? a : Number(hi); return { lo: Math.min(a, b), hi: Math.max(a, b) }; }

export function parseStat(line) {
  const t = stripStatMarkup(line);
  let m = FLAT.exec(t);
  if (m) {
    const { lo, hi } = range(m[1], m[2]);
    const what = m[3];
    if (what === 'all Attributes') return { stats: ['str', 'dex', 'int'].map((key) => ({ key, lo, hi })) };
    if (what === 'maximum Life') return { stats: [{ key: 'life', lo, hi }] };
    if (what === 'maximum Mana') return { stats: [{ key: 'mana', lo, hi }] };
    if (what === 'Spirit') return { stats: [{ key: 'spirit', lo, hi }] };
    return { stats: [{ key: ATTR_NAME[what], lo, hi }] };
  }
  m = RES.exec(t);
  if (m) { const { lo, hi } = range(m[1], m[2]); return { stats: [{ key: RES_NAME[m[3]], lo, hi }] }; }
  m = ALL_ELE.exec(t);
  if (m) { const { lo, hi } = range(m[1], m[2]); return { stats: ['fireRes', 'coldRes', 'lightRes'].map((key) => ({ key, lo, hi })) }; }
  return null;
}

// Relative imports (NOT /static/js/…) so node --test resolves them; in the
// browser these resolve relative to /static/js/build-math.js all the same. This
// matches editor-render.js / mod-core.js convention. Both modules are import-free
// and pure, so pulling them in from the Node projector (Task 2) is safe too.
import { gearViolations, setupViolations } from './build-rules.js';
import { modViolations, resolveMod } from './mod-core.js';

const ATTR_KEYS = ['str', 'dex', 'int'];
const AGG_KEYS = ['life', 'mana', 'spirit', 'fireRes', 'coldRes', 'lightRes', 'chaosRes'];
const zero = () => ({ lo: 0, hi: 0 });
const add = (acc, { lo, hi }) => { acc.lo += lo; acc.hi += hi; };

function addLines(acc, lines) {
  for (const line of lines || []) {
    const parsed = parseStat(line);
    if (!parsed) continue;
    for (const s of parsed.stats) (acc[s.key] ??= zero()) && add(acc[s.key], s);
  }
}

// Chosen base mods (dynamic) → their display text via mod-pools, parsed the same way.
function modLines(cell, pools) {
  if (!pools) return [];
  const out = [];
  for (const m of cell.mods || []) { const r = resolveMod(pools, m); if (r?.text) out.push(...String(r.text).split('\n')); }
  if (cell.corrupted) { const r = resolveMod(pools, cell.corrupted); if (r?.text) out.push(...String(r.text).split('\n')); }
  return out;
}

export function computeMath(build, ctx) {
  const { planner, itemMath, pools, treeLines } = ctx;
  const cells = Object.values(build.gear || {}).filter((c) => c && c.item);

  // --- sums (class base + gear fixed lines + chosen mods + tree lines)
  const sums = {};
  for (const k of [...ATTR_KEYS, ...AGG_KEYS]) sums[k] = zero();
  const base = itemMath.classBase?.[build.class] || null;
  if (base) { for (const k of ATTR_KEYS) add(sums[k], { lo: base[k], hi: base[k] }); add(sums.life, { lo: base.life, hi: base.life }); add(sums.mana, { lo: base.mana, hi: base.mana }); }
  for (const cell of cells) {
    const im = itemMath.items?.[cell.item.slug];
    if (im) addLines(sums, im.lines);
    addLines(sums, modLines(cell, pools));
  }
  addLines(sums, treeLines || []);

  // --- requirements (items only; gems add a character-level gate)
  const required = { str: 0, dex: 0, int: 0 };
  let levelReq = 0;
  for (const cell of cells) {
    const req = itemMath.items?.[cell.item.slug]?.req;
    if (!req) continue;
    required.str = Math.max(required.str, req.str || 0);
    required.dex = Math.max(required.dex, req.dex || 0);
    required.int = Math.max(required.int, req.int || 0);
    levelReq = Math.max(levelReq, req.level || 0);
  }
  for (const setup of build.skills || []) {
    const lvl = itemMath.gemLevel?.[setup.gem?.slug];
    if (typeof lvl === 'number') levelReq = Math.max(levelReq, lvl);
  }

  const attributes = {};
  const warnings = [];
  for (const k of ATTR_KEYS) {
    const available = { lo: sums[k].lo, hi: sums[k].hi };
    const deficit = Math.max(0, required[k] - available.lo); // worst-case availability
    attributes[k] = { required: required[k], available, deficit };
    if (deficit > 0) warnings.push(`Need ${deficit} more ${{ str: 'Strength', dex: 'Dexterity', int: 'Intelligence' }[k]}`);
  }
  const aggregates = {}; for (const k of AGG_KEYS) aggregates[k] = { lo: sums[k].lo, hi: sums[k].hi };

  // --- consolidated legality warnings (reuse the existing pure checks)
  for (const v of gearViolations(build, planner)) warnings.push(v.message);
  for (const v of setupViolations(build, planner.gems || {})) warnings.push(v.message);
  if (pools) for (const cell of cells) for (const v of modViolations(cell, pools)) warnings.push(v.message);

  return { attributes, level: { required: levelReq }, aggregates, warnings };
}
