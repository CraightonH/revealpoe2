// public/js/build-store.js
// Pure ES module — Build Planner persistence core. Importable by both node
// tests and the browser (query-core.js pattern): storage, clock and uuid are
// injected, no globals touched. Nothing outside this module reads the raw
// localStorage keys.

export const STORE_KEY = 'reveal.builds.v1';
export const CORRUPT_KEY = 'reveal.builds.corrupt';
export const SCHEMA_VERSION = 3;

/**
 * Ceiling on total stored builds. Variants are ordinary builds, so a group of
 * four counts as four — 300 is roughly 75 four-build groups.
 *
 * Sized from measurement, not taste: a build serializes to ~6 KB typical and
 * ~11 KB heavy (15 slots x 6 mods, 8 setups x 5 supports, a 900-char tree code),
 * against a ~5 M-char localStorage budget shared with every other key on the
 * origin. 300 lands at ~36% (typical) to ~65% (heavy). It also keeps the store
 * parseable at interactive speed: every mutation re-serializes the WHOLE store
 * and the editor re-reads it per render, which is ~12 ms of JSON work at this
 * size and grows linearly.
 *
 * This bounds accumulation; `maxlength` on the notes/description textareas
 * bounds any single build. Neither alone is sufficient — a full store of
 * max-length notes can still exceed the budget, which is why a rejected write
 * must degrade gracefully rather than lose the edit (see StoreWriteError).
 */
export const MAX_BUILDS = 300;

/**
 * Structural bounds for an UNTRUSTED build (see {@link clampBuild}).
 *
 * Authoring is already bounded by the DOM — `maxlength` on the text fields, a
 * fixed 15-well gear grid, a fixed socket count per setup. Decoded share codes
 * are not: the codec validates *shape*, never *size*. Without these, a hostile
 * or accidentally-huge code could exhaust storage, break the layout with a
 * megabyte-long title, or hang the page with tens of thousands of skill rows.
 *
 * Each value is comfortably above any real build, so clamping is invisible in
 * normal use. The string limits mirror the inputs' own maxlength attributes.
 */
export const LIMITS = {
  name: 60,               // = the rename input's maxlength
  label: 40,              // = the variant label input's maxlength
  description: 1000,
  notes: 10000,
  setups: 24,             // real guides run ~8-12
  supportsPerSetup: 8,    // 5 sockets + headroom for over-socketed warnings
  unassigned: 100,        // the site-wide "add to build" tray
  gearSlots: 24,          // 15 real slots + headroom; builds-render iterates RAW keys
  mods: 8,                // 6 legal (3 prefix + 3 suffix) + headroom
  notablePriority: 200,
  treeCode: 4000,         // a full v7 code is well under 1 KB
  grantedKeys: 60,        // one per equipped item that grants a skill
};

const clampStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v);

/**
 * Clamp an untrusted build to {@link LIMITS}. TRUNCATES rather than rejects — a
 * shared build should still open, just trimmed — and reports what it trimmed so
 * the caller can say so instead of silently altering someone's build.
 * Tolerates structurally broken input; never throws.
 * @param {object} b
 * @returns {{ build: object, trimmed: string[] }}
 */
export function clampBuild(b) {
  const trimmed = [];
  const src = isObj(b) ? b : {};
  const out = { ...src };
  const note = (msg) => { if (!trimmed.includes(msg)) trimmed.push(msg); };

  for (const [field, max] of [['name', LIMITS.name], ['label', LIMITS.label],
                              ['description', LIMITS.description], ['notes', LIMITS.notes]]) {
    if (typeof src[field] === 'string' && src[field].length > max) {
      out[field] = src[field].slice(0, max);
      note(`${field} shortened to ${max} characters`);
    }
  }

  if (isObj(src.gear)) {
    const entries = Object.entries(src.gear);
    const kept = entries.slice(0, LIMITS.gearSlots);
    if (entries.length > kept.length) note(`gear reduced to ${LIMITS.gearSlots} slots`);
    out.gear = {};
    for (const [slot, cell] of kept) {
      if (!isObj(cell)) { out.gear[slot] = cell; continue; }
      const g = { ...cell };
      if (Array.isArray(cell.mods) && cell.mods.length > LIMITS.mods) {
        g.mods = cell.mods.slice(0, LIMITS.mods);
        note(`chosen mods reduced to ${LIMITS.mods} per item`);
      }
      out.gear[slot] = g;
    }
  }

  if (Array.isArray(src.skills)) {
    let cut = src.skills.length > LIMITS.setups;
    out.skills = src.skills.slice(0, LIMITS.setups).map((setup) => {
      if (!isObj(setup)) return setup;
      if (Array.isArray(setup.supports) && setup.supports.length > LIMITS.supportsPerSetup) {
        cut = true;
        return { ...setup, supports: setup.supports.slice(0, LIMITS.supportsPerSetup) };
      }
      return setup;
    });
    if (cut) note(`skill setups reduced to ${LIMITS.setups}, with ${LIMITS.supportsPerSetup} supports each`);
  }

  if (Array.isArray(src.unassigned) && src.unassigned.length > LIMITS.unassigned) {
    out.unassigned = src.unassigned.slice(0, LIMITS.unassigned);
    note(`unassigned items reduced to ${LIMITS.unassigned}`);
  }

  if (isObj(src.tree)) {
    const tree = { ...src.tree };
    if (typeof tree.code === 'string' && tree.code.length > LIMITS.treeCode) {
      tree.code = null;   // a code this long is not a v7 code; drop, do not truncate
      note('an invalid passive tree code was dropped');
    }
    if (Array.isArray(tree.notablePriority) && tree.notablePriority.length > LIMITS.notablePriority) {
      tree.notablePriority = tree.notablePriority.slice(0, LIMITS.notablePriority);
      note(`notable priority reduced to ${LIMITS.notablePriority} entries`);
    }
    out.tree = tree;
  }

  if (isObj(src.grantedSupports)) {
    const entries = Object.entries(src.grantedSupports).slice(0, LIMITS.grantedKeys);
    if (entries.length < Object.keys(src.grantedSupports).length) note('item-granted skill data reduced');
    out.grantedSupports = Object.fromEntries(entries.map(([k, list]) => [
      k, Array.isArray(list) ? list.slice(0, LIMITS.supportsPerSetup) : list,
    ]));
  }

  if (Array.isArray(src.variants)) {
    out.variants = src.variants.map((v) => {
      if (!isObj(v) || typeof v.label !== 'string' || v.label.length <= LIMITS.label) return v;
      note(`variant labels shortened to ${LIMITS.label} characters`);
      return { ...v, label: v.label.slice(0, LIMITS.label) };
    });
  }

  return { build: out, trimmed };
}

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

  // A build's own label — its role in its group. Only meaningful for a group's
  // ROOT: a variant's label lives on its parent's entry (a property of the
  // relationship), and the root has no such entry.
  if (b.label !== undefined && b.label !== null && !isStr(b.label)) errors.push('label: expected string or null');

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

/** Thrown when a create would exceed {@link MAX_BUILDS}. */
export class StoreLimitError extends Error {
  constructor(limit) {
    super(`build limit reached (${limit})`);
    this.name = 'StoreLimitError';
    this.limit = limit;
  }
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
      // The park is best-effort — if storage is also full this setItem throws,
      // and read() backs EVERY method, so letting it escape would fail the whole
      // planner instead of recovering. Losing the backup beats not loading.
      try { storage.setItem(CORRUPT_KEY, raw); } catch { /* no room for the backup */ }
      try { storage.removeItem(STORE_KEY); } catch { /* nothing else to try */ }
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
      if (s.order.length >= MAX_BUILDS) throw new StoreLimitError(MAX_BUILDS);
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
      if (s.order.length >= MAX_BUILDS) throw new StoreLimitError(MAX_BUILDS);
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
    /**
     * Duplicate `parentId` into a labeled sibling and append it to its list.
     *
     * The label is the child's ROLE IN THE GROUP ("Leveling"); the child's
     * `name` is its own identity and is inherited verbatim from the parent. They
     * are two independent strings — a group is normally one title ("Stormweaver
     * CoC") across every phase, told apart by label. Do NOT re-couple them.
     */
    addVariant(parentId, label) {
      const s = read();
      const parent = s.builds[parentId];
      if (!parent) return null;
      if (s.order.length >= MAX_BUILDS) throw new StoreLimitError(MAX_BUILDS);
      const t = now();
      // `label` is deliberately cleared: a variant's label lives on the parent's
      // ENTRY, so a copied one is stale data that would resurface as the child's
      // own label if it were ever promoted to a root. `variants` likewise — groups
      // are one level deep.
      const child = { ...deepCopy(parent), id: uuid(), label: null,
                      variants: [], createdAt: t, updatedAt: t };
      s.order.push(child.id);
      s.builds[child.id] = child;
      s.builds[parentId] = { ...parent,
        variants: [...(parent.variants ?? []), { label, buildId: child.id }], updatedAt: t };
      write(s);
      emit('create', child.id);
      return child;
    },
    /**
     * Relabel a variant entry. Touches ONLY the parent's entry — the variant
     * build's own `name` is a separate string the user edits from the dossier
     * head. (Before 2026-07-26 this also wrote `child.name`, which made the two
     * look like one field and left no way to title a build independently of its
     * role in the group.)
     */
    renameVariant(parentId, buildId, label) {
      const s = read();
      const parent = s.builds[parentId];
      if (!parent?.variants?.some((v) => v.buildId === buildId)) return null;
      s.builds[parentId] = { ...parent, updatedAt: now(),
        variants: parent.variants.map((v) => (v.buildId === buildId ? { ...v, label } : v)) };
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
    /**
     * Set a build's label — its role in its group — regardless of whether it is
     * the root or a variant. Callers should not have to know that a variant's
     * label lives on its parent's entry while a root's lives on the build.
     * Never touches `name` (the build's own title).
     */
    setLabel(buildId, label) {
      const s = read();
      const self = s.builds[buildId];
      if (!self) return null;
      const t = now();
      const owner = s.order.find((id) => s.builds[id]?.variants?.some((v) => v.buildId === buildId));
      if (owner) {
        const p = s.builds[owner];
        s.builds[owner] = { ...p, updatedAt: t,
          variants: p.variants.map((v) => (v.buildId === buildId ? { ...v, label } : v)) };
      } else {
        s.builds[buildId] = { ...self, label, updatedAt: t };
      }
      write(s);
      emit('update', buildId);
      return s.builds[owner ?? buildId];
    },
    /**
     * Default label for the next variant added to this build's group. The ROOT
     * is Variant 1, so the first addition is Variant 2. Skips numbers already
     * taken so a hand-picked label can't be duplicated.
     */
    nextVariantLabel(buildId) {
      const s = read();
      const self = s.builds[buildId];
      if (!self) return 'Variant 2';
      const owner = s.order.find((id) => s.builds[id]?.variants?.some((v) => v.buildId === buildId));
      const parent = owner ? s.builds[owner] : self;
      const list = parent.variants ?? [];
      // POSITIONAL: the new build's place in the group. The root is 1, so with N
      // existing variants the newcomer is N+2. Deliberately NOT gap-filling —
      // an earlier version preferred the lowest unused number, which silently
      // collapsed to 'Variant 2' forever as soon as any tab was renamed (once
      // 'Leveling' replaces 'Variant 2', that slot reads as free).
      const taken = new Set([parent.label || 'Variant 1', ...list.map((v) => v.label)]);
      let n = list.length + 2;                     // +1 for the root, +1 for the new one
      while (taken.has(`Variant ${n}`)) n++;       // only to avoid an exact duplicate
      return `Variant ${n}`;
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
      // Carries BOTH `buildId` (as stored) and the resolved `build`. Returning
      // only one spelling repeatedly tripped callers who reached for the other.
      const variants = (parent.variants ?? [])
        .map((v) => ({ label: v.label, buildId: v.buildId, build: s.builds[v.buildId] }))
        .filter((v) => v.build);
      return { parent, variants };
    },
    /**
     * Materialize a decoded group locally: every build gets a fresh id and the
     * parent's list is relinked to them. Old-schema decoded builds are migrated.
     */
    importGroup(group) {
      const s = read();
      const incoming = 1 + (group.variants ?? []).length;
      // All-or-nothing: a half-imported group would leave the visitor with a
      // parent whose variants silently vanished.
      if (s.order.length + incoming > MAX_BUILDS) throw new StoreLimitError(MAX_BUILDS);
      // Everything here came off a share code, so clamp before it lands.
      const fresh = (b, over) => {
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = clampBuild(migrate(deepCopy(b))).build;
        return emptyBuild({ now, uuid, ...rest, ...over });
      };
      const variants = (group.variants ?? []).map(({ label, build }) => {
        const child = fresh(build, { variants: [] });
        s.order.push(child.id);
        s.builds[child.id] = child;
        return { label: clampStr(label, LIMITS.label), buildId: child.id };
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
