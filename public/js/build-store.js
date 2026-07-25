// public/js/build-store.js
// Pure ES module — Build Planner persistence core. Importable by both node
// tests and the browser (query-core.js pattern): storage, clock and uuid are
// injected, no globals touched. Nothing outside this module reads the raw
// localStorage keys.

export const STORE_KEY = 'reveal.builds.v1';
export const CORRUPT_KEY = 'reveal.builds.corrupt';
export const SCHEMA_VERSION = 3;

const defaultNow = () => Date.now();
const defaultUuid = () => globalThis.crypto.randomUUID();

/**
 * A fresh v3 build. `now`/`uuid` are injectable for tests; remaining keys
 * are field overrides.
 */
export function emptyBuild({ now = defaultNow, uuid = defaultUuid, ...overrides } = {}) {
  const t = now();
  return {
    id: uuid(),
    schema: SCHEMA_VERSION,
    name: 'Untitled Build',
    notes: '',
    description: '',
    createdAt: t,
    updatedAt: t,
    class: null,
    ascendancy: null,
    gear: {},
    unassigned: [],
    skills: [],
    tree: { code: null, notablePriority: [] },
    // Ordered variant siblings (Amendment 2). A variant is a full standalone
    // build; this list is the ONLY grouping structure and is one level deep.
    variants: [],
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
  if (b.description !== undefined && !isStr(b.description)) errors.push('description: expected string');
  for (const k of ['id']) if (b[k] !== undefined && !isStr(b[k])) errors.push(`${k}: expected string`);
  for (const k of ['createdAt', 'updatedAt']) if (b[k] !== undefined && !isNum(b[k])) errors.push(`${k}: expected number`);
  for (const k of ['class', 'ascendancy']) if (b[k] !== null && !isStr(b[k])) errors.push(`${k}: expected string or null`);

  if (!isObj(b.gear)) errors.push('gear: expected object');
  else {
    for (const [slot, g] of Object.entries(b.gear)) {
      if (!isObj(g)) { errors.push(`gear.${slot}: expected object`); continue; }
      if (g.item !== null && g.item !== undefined) checkItemRef(g.item, `gear.${slot}.item`, errors);
      // v2 cells carry `mods` (base explicits) and `corrupted` (unique implicit).
      // Legacy cells (`wishlist`) and cells missing these keys stay valid for
      // forward/backward-compatible decode of old share codes.
      if (g.mods !== undefined) {
        if (!Array.isArray(g.mods)) errors.push(`gear.${slot}.mods: expected array`);
        else g.mods.forEach((m, i) => {
          if (!isObj(m) || !isStr(m.affix)) errors.push(`gear.${slot}.mods[${i}].affix: expected string`);
          else if (m.tier !== undefined && !isStr(m.tier) && !isNum(m.tier)) errors.push(`gear.${slot}.mods[${i}].tier: expected string/number`);
        });
      }
      if (g.corrupted !== undefined && g.corrupted !== null) {
        if (!isObj(g.corrupted) || !isStr(g.corrupted.affix)) errors.push(`gear.${slot}.corrupted.affix: expected string`);
        else if (g.corrupted.tier !== undefined && !isStr(g.corrupted.tier) && !isNum(g.corrupted.tier)) errors.push(`gear.${slot}.corrupted.tier: expected string/number`);
      }
      if (g.wishlist !== undefined && (!Array.isArray(g.wishlist) || g.wishlist.some((w) => !isStr(w)))) {
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

  if (b.variants !== undefined) {
    if (!Array.isArray(b.variants)) errors.push('variants: expected array');
    else b.variants.forEach((v, i) => {
      if (!isObj(v)) { errors.push(`variants[${i}]: expected {label, buildId}`); return; }
      if (!isStr(v.label)) errors.push(`variants[${i}].label: expected string`);
      if (!isStr(v.buildId)) errors.push(`variants[${i}].buildId: expected string`);
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

// Schema migrations, keyed by from-version. v1->v2: the per-slot affix
// "wishlist" became real chosen mods; convert cells to the {mods, corrupted}
// shape (wishlists were never written by a shipped UI, so they drop cleanly).
const MIGRATIONS = {
  1: (build) => ({
    ...build,
    schema: 2,
    gear: Object.fromEntries(Object.entries(build.gear ?? {}).map(([slot, g]) => {
      const { wishlist, ...rest } = g ?? {};
      return [slot, { item: rest.item ?? null, mods: rest.mods ?? [], corrupted: rest.corrupted ?? null }];
    })),
  }),
  // v2->v3: builds gained an ordered `variants` list (Amendment 2).
  2: (build) => ({ ...build, schema: 3, variants: build.variants ?? [] }),
};

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
      // A deleted build must never linger as a variant reference. Deleting a
      // PARENT is the other direction: its variants are orphaned, not deleted.
      for (const bid of s.order) {
        const b = s.builds[bid];
        if (b?.variants?.some((v) => v.buildId === id)) {
          s.builds[bid] = { ...b, variants: b.variants.filter((v) => v.buildId !== id) };
        }
      }
      write(s);
      emit('remove', id);
      return true;
    },
    duplicate(id) {
      const s = read();
      const cur = s.builds[id];
      if (!cur) return null;
      const t = now();
      // A duplicate is standalone: inheriting the variant list would leave two
      // parents pointing at one variant build.
      const copy = { ...deepCopy(cur), id: uuid(), name: `${cur.name} (copy)`,
                     variants: [], createdAt: t, updatedAt: t };
      s.order.push(copy.id);
      s.builds[copy.id] = copy;
      write(s);
      emit('create', copy.id);
      return copy;
    },
    /** Duplicate `parentId` into a labeled sibling and append it to its list. */
    addVariant(parentId, label) {
      const s = read();
      const parent = s.builds[parentId];
      if (!parent) return null;
      const t = now();
      const child = { ...deepCopy(parent), id: uuid(), name: label,
                      variants: [], createdAt: t, updatedAt: t };
      s.order.push(child.id);
      s.builds[child.id] = child;
      s.builds[parentId] = { ...parent,
        variants: [...(parent.variants ?? []), { label, buildId: child.id }], updatedAt: t };
      write(s);
      emit('create', child.id);
      return child;
    },
    /** Retitle a variant entry; the variant build's name tracks its label. */
    renameVariant(parentId, buildId, label) {
      const s = read();
      const parent = s.builds[parentId];
      if (!parent?.variants?.some((v) => v.buildId === buildId)) return null;
      const t = now();
      s.builds[parentId] = { ...parent, updatedAt: t,
        variants: parent.variants.map((v) => (v.buildId === buildId ? { ...v, label } : v)) };
      const child = s.builds[buildId];
      if (child) s.builds[buildId] = { ...child, name: label, updatedAt: t };
      write(s);
      emit('update', parentId);
      return s.builds[parentId];
    },
    /** Drop a variant entry. The variant build itself survives as standalone. */
    removeVariant(parentId, buildId) {
      const s = read();
      const parent = s.builds[parentId];
      if (!parent?.variants?.length) return null;
      s.builds[parentId] = { ...parent, updatedAt: now(),
        variants: parent.variants.filter((v) => v.buildId !== buildId) };
      write(s);
      emit('update', parentId);
      return s.builds[parentId];
    },
    /** The build whose variant list contains `buildId`, or null. */
    parentOf(buildId) {
      const s = read();
      for (const id of s.order) {
        if (s.builds[id]?.variants?.some((v) => v.buildId === buildId)) return s.builds[id];
      }
      return null;
    },
    /**
     * The share group rooted at `buildId` — its parent if it is a variant, plus
     * every LIVE variant in list order. Dangling references are skipped so a
     * half-written store still shares cleanly.
     */
    group(buildId) {
      const s = read();
      const self = s.builds[buildId];
      if (!self) return null;
      let parent = self;
      for (const id of s.order) {
        if (s.builds[id]?.variants?.some((v) => v.buildId === buildId)) { parent = s.builds[id]; break; }
      }
      const variants = (parent.variants ?? [])
        .map((v) => ({ label: v.label, build: s.builds[v.buildId] }))
        .filter((v) => v.build);
      return { parent, variants };
    },
    /**
     * Materialize a decoded group locally: every build gets a fresh id and the
     * parent's list is relinked to them. Old-schema decoded builds are migrated.
     */
    importGroup(group) {
      const s = read();
      const fresh = (b, over) => {
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = migrate(deepCopy(b));
        return emptyBuild({ now, uuid, ...rest, ...over });
      };
      const variants = (group.variants ?? []).map(({ label, build }) => {
        const child = fresh(build, { variants: [] });
        s.order.push(child.id);
        s.builds[child.id] = child;
        return { label, buildId: child.id };
      });
      const parent = fresh(group.parent, { variants });
      s.order.push(parent.id);
      s.builds[parent.id] = parent;
      write(s);
      emit('create', parent.id);
      return parent;
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
