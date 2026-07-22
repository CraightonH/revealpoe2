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

  if (b.grantedSupports !== undefined) {
    if (!isObj(b.grantedSupports)) errors.push('grantedSupports: expected object');
    else {
      for (const [k, list] of Object.entries(b.grantedSupports)) {
        if (!Array.isArray(list)) { errors.push(`grantedSupports.${k}: expected array`); continue; }
        list.forEach((sup, i) => {
          if (!isObj(sup) || !isStr(sup.slug)) errors.push(`grantedSupports.${k}[${i}].slug: expected string`);
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

const deepCopy = (v) => JSON.parse(JSON.stringify(v));

// Schema migrations, keyed by from-version; v1 has none. A future schema
// bump adds `1: (build) => ({ ...migrated, schema: 2 })` here.
const MIGRATIONS = {};

function migrate(build) {
  let b = build;
  while (b.schema < SCHEMA_VERSION && MIGRATIONS[b.schema]) b = MIGRATIONS[b.schema](b);
  return b;
}

/** Thrown when the backing storage rejects a write (quota). */
export class StoreWriteError extends Error {
  constructor(cause) {
    super('build store write failed (storage quota?)');
    this.name = 'StoreWriteError';
    this.cause = cause;
  }
}

/**
 * Build store over a localStorage-like interface. All mutation goes through
 * here; the raw keys are private to this module.
 */
export function createStore(storage, { now = defaultNow, uuid = defaultUuid } = {}) {
  const subscribers = new Set();
  const emit = (type, id = null) => { for (const fn of subscribers) fn({ type, id }); };

  function read() {
    const raw = storage.getItem(STORE_KEY);
    if (raw === null) return { order: [], builds: {} };
    try {
      const state = JSON.parse(raw);
      if (!state || !Array.isArray(state.order) || typeof state.builds !== 'object' || state.builds === null) {
        throw new Error('bad shape');
      }
      for (const id of state.order) state.builds[id] = migrate(state.builds[id]);
      return state;
    } catch {
      // Never silently destroy user data: park the corrupt payload, start empty.
      storage.setItem(CORRUPT_KEY, raw);
      storage.removeItem(STORE_KEY);
      return { order: [], builds: {} };
    }
  }

  function write(state) {
    try {
      storage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      throw new StoreWriteError(e);
    }
  }

  return {
    list() {
      const s = read();
      return s.order.map((id) => s.builds[id]);
    },
    get(id) {
      return read().builds[id] ?? null;
    },
    create(partial = {}) {
      const s = read();
      const build = emptyBuild({ now, uuid, ...partial });
      s.order.push(build.id);
      s.builds[build.id] = build;
      write(s);
      emit('create', build.id);
      return build;
    },
    update(id, patch) {
      const s = read();
      const cur = s.builds[id];
      if (!cur) return null;
      // Identity fields are store-owned; a patch never moves them.
      const { id: _i, schema: _s, createdAt: _c, ...rest } = patch;
      const next = { ...cur, ...rest, updatedAt: now() };
      s.builds[id] = next;
      write(s);
      emit('update', id);
      return next;
    },
    remove(id) {
      const s = read();
      if (!s.builds[id]) return false;
      delete s.builds[id];
      s.order = s.order.filter((x) => x !== id);
      write(s);
      emit('remove', id);
      return true;
    },
    duplicate(id) {
      const s = read();
      const cur = s.builds[id];
      if (!cur) return null;
      const t = now();
      const copy = { ...deepCopy(cur), id: uuid(), name: `${cur.name} (copy)`, createdAt: t, updatedAt: t };
      s.order.push(copy.id);
      s.builds[copy.id] = copy;
      write(s);
      emit('create', copy.id);
      return copy;
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    // Re-read + notify. The browser host wires this to the cross-tab
    // 'storage' event: e.key === STORE_KEY && store.refresh().
    refresh() {
      emit('refresh', null);
    },
  };
}
