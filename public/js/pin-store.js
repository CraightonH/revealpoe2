// Small reference-only localStorage store. Consumers own rendering and provide
// the fresh document set used to resolve references after each page load.
export const PIN_STORAGE_KEY = 'tcPins';

function normalizeRef(value) {
  if (!value || typeof value !== 'object') return null;
  const category = typeof value.category === 'string' ? value.category.trim() : '';
  const slug = typeof value.slug === 'string' ? value.slug.trim() : '';
  if (!category || !slug) return null;
  const ref = { category, slug };
  if (category === 'base') {
    const classSlug = typeof value.classSlug === 'string' ? value.classSlug.trim() : '';
    if (!classSlug) return null;
    ref.classSlug = classSlug;
  }
  return ref;
}

export function pinKey(ref) {
  const normalized = normalizeRef(ref);
  return normalized ? `${normalized.category}:${normalized.slug}` : '';
}

export function createPinStore({ key = PIN_STORAGE_KEY, storage = window.localStorage } = {}) {
  const listeners = new Set();

  function read() {
    try {
      const value = JSON.parse(storage.getItem(key));
      if (value?.v !== 1 || !Array.isArray(value.pins)) return [];
      const seen = new Set();
      return value.pins.map(normalizeRef).filter((ref) => {
        const identity = pinKey(ref);
        if (!identity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
    } catch {
      return [];
    }
  }

  let pins = read();
  const snapshot = () => pins.map((ref) => ({ ...ref }));

  function write(next, notify = true) {
    pins = next.map(normalizeRef).filter(Boolean);
    try { storage.setItem(key, JSON.stringify({ v: 1, pins })); } catch { /* storage can be unavailable */ }
    if (notify) listeners.forEach((listener) => listener(snapshot()));
  }

  function isPinned(ref) {
    const identity = pinKey(ref);
    return !!identity && pins.some((pin) => pinKey(pin) === identity);
  }

  function add(ref) {
    const normalized = normalizeRef(ref);
    if (!normalized || isPinned(normalized)) return false;
    write([...pins, normalized]);
    return true;
  }

  function remove(ref) {
    const identity = pinKey(ref);
    const next = pins.filter((pin) => pinKey(pin) !== identity);
    if (next.length === pins.length) return false;
    write(next);
    return true;
  }

  function toggle(ref) {
    return isPinned(ref) ? (remove(ref), false) : (add(ref), true);
  }

  function clear() {
    if (!pins.length) return;
    write([]);
  }

  function resolve(docs) {
    const byIdentity = new Map();
    for (const doc of docs || []) {
      const identity = pinKey({
        category: doc.category,
        slug: doc.category === 'affix' ? doc.typeSlug : doc.slug,
        classSlug: doc.classSlug,
      });
      if (identity && !byIdentity.has(identity)) byIdentity.set(identity, doc);
    }
    const resolved = [];
    const kept = [];
    for (const ref of pins) {
      const doc = byIdentity.get(pinKey(ref));
      if (!doc || (ref.category === 'base' && doc.classSlug !== ref.classSlug)) continue;
      kept.push(ref);
      resolved.push({ ref: { ...ref }, doc });
    }
    const removed = pins.length - kept.length;
    if (removed) write(kept);
    return { resolved, removed };
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== key) return;
    pins = read();
    listeners.forEach((listener) => listener(snapshot()));
  });

  return { getRefs: snapshot, isPinned, add, remove, toggle, clear, resolve, subscribe };
}
