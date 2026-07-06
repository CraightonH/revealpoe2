// public/js/build-store.js
// Pure ES module — Build Planner persistence core. Importable by both node
// tests and the browser (query-core.js pattern): storage, clock and uuid are
// injected, no globals touched. Nothing outside this module reads the raw
// localStorage keys.

export const STORE_KEY = 'reveal.builds.v1';
export const CORRUPT_KEY = 'reveal.builds.corrupt';
export const SCHEMA_VERSION = 1;

const defaultNow = () => Date.now();
const defaultUuid = () => globalThis.crypto.randomUUID();

/**
 * A fresh v1 build. `now`/`uuid` are injectable for tests; remaining keys
 * are field overrides.
 */
export function emptyBuild({ now = defaultNow, uuid = defaultUuid, ...overrides } = {}) {
  const t = now();
  return {
    id: uuid(),
    schema: SCHEMA_VERSION,
    name: 'Untitled Build',
    notes: '',
    createdAt: t,
    updatedAt: t,
    class: null,
    ascendancy: null,
    gear: {},
    unassigned: [],
    skills: [],
    tree: { code: null, notablePriority: [] },
    ...overrides,
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function checkItemRef(v, path, errors) {
  if (!isObj(v)) { errors.push(`${path}: expected {kind, slug}`); return; }
  if (!isStr(v.kind)) errors.push(`${path}.kind: expected string`);
  if (!isStr(v.slug)) errors.push(`${path}.slug: expected string`);
}

/**
 * Shape-check a build (or an id-less canonical build from the codec).
 * Unknown extra fields are allowed — forward compatibility.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateBuild(b) {
  const errors = [];
  if (!isObj(b)) return { ok: false, errors: ['build: expected object'] };

  if (!isNum(b.schema) || b.schema < 1) errors.push('schema: expected number >= 1');
  if (!isStr(b.name)) errors.push('name: expected string');
  if (!isStr(b.notes)) errors.push('notes: expected string');
  for (const k of ['id']) if (b[k] !== undefined && !isStr(b[k])) errors.push(`${k}: expected string`);
  for (const k of ['createdAt', 'updatedAt']) if (b[k] !== undefined && !isNum(b[k])) errors.push(`${k}: expected number`);
  for (const k of ['class', 'ascendancy']) if (b[k] !== null && !isStr(b[k])) errors.push(`${k}: expected string or null`);

  if (!isObj(b.gear)) errors.push('gear: expected object');
  else {
    for (const [slot, g] of Object.entries(b.gear)) {
      if (!isObj(g)) { errors.push(`gear.${slot}: expected object`); continue; }
      if (g.item !== null) checkItemRef(g.item, `gear.${slot}.item`, errors);
      if (!Array.isArray(g.wishlist) || g.wishlist.some((w) => !isStr(w))) {
        errors.push(`gear.${slot}.wishlist: expected string[]`);
      }
    }
  }

  if (!Array.isArray(b.unassigned)) errors.push('unassigned: expected array');
  else b.unassigned.forEach((it, i) => checkItemRef(it, `unassigned[${i}]`, errors));

  if (!Array.isArray(b.skills)) errors.push('skills: expected array');
  else {
    b.skills.forEach((s, i) => {
      if (!isObj(s)) { errors.push(`skills[${i}]: expected object`); return; }
      if (!isObj(s.gem) || !isStr(s.gem.slug)) errors.push(`skills[${i}].gem.slug: expected string`);
      if (s.level !== null && !isNum(s.level)) errors.push(`skills[${i}].level: expected number or null`);
      if (!Array.isArray(s.supports)) errors.push(`skills[${i}].supports: expected array`);
      else s.supports.forEach((sup, j) => {
        if (!isObj(sup) || !isStr(sup.slug)) errors.push(`skills[${i}].supports[${j}].slug: expected string`);
      });
    });
  }

  if (!isObj(b.tree)) errors.push('tree: expected object');
  else {
    if (b.tree.code !== null && !isStr(b.tree.code)) errors.push('tree.code: expected string or null');
    if (!Array.isArray(b.tree.notablePriority)) errors.push('tree.notablePriority: expected number[]');
    else b.tree.notablePriority.forEach((h, i) => {
      if (!isNum(h)) errors.push(`tree.notablePriority[${i}]: expected number`);
    });
  }

  return { ok: errors.length === 0, errors };
}
