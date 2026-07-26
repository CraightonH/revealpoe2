// public/js/build-host.js
// Browser-only singleton over build-store.js: one store instance shared by
// every importer on a page (builds-page.js, add-to-build.js), wired to the
// cross-tab 'storage' event. Pure modules stay environment-free; this is the
// one place the real localStorage is bound.
import { createStore, STORE_KEY, StoreWriteError, StoreLimitError, MAX_BUILDS } from '/static/js/build-store.js';

let store = null;
let itemMath = null;
let itemMathLoading = null;
let buildExport = null;
let buildExportLoading = null;
export function getStore() {
  if (!store) {
    store = createStore(window.localStorage);
    window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) store.refresh(); });
  }
  return store;
}

/**
 * Run a store mutation; report (instead of throwing) the two expected refusals.
 * The buttons that create builds are disabled at the ceiling, so StoreLimitError
 * is the belt-and-braces path (cross-tab additions, keyboard activation).
 */
export function safeWrite(fn) {
  try { return fn(); }
  catch (e) {
    if (e instanceof StoreLimitError) {
      window.alert(`You've reached the limit of ${MAX_BUILDS} saved builds `
        + '(variants count too). Delete a build to make room.');
      return null;
    }
    if (e instanceof StoreWriteError) {
      window.alert("Couldn't save — browser storage is full. "
        + 'Try deleting a build, or shortening very long notes.');
      return null;
    }
    throw e;
  }
}

export function loadItemMath() {
  if (itemMath) return Promise.resolve(itemMath);
  itemMathLoading ??= fetch('/static/generated/item-math.json')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((data) => { itemMath = data; return data; })
    .catch((e) => { itemMathLoading = null; throw e; });
  return itemMathLoading;
}

/**
 * The `.build` export id maps, fetched only when a user actually exports.
 * Two artifacts (graph-sourced gem/ascendancy ids + source-sourced passive
 * ids), merged into one object.
 */
export function loadBuildExport() {
  if (buildExport) return Promise.resolve(buildExport);
  buildExportLoading ??= Promise.all([
    fetch('/static/generated/build-export.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch('/static/generated/passive-build-ids.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  ])
    .then(([ids, passives]) => { buildExport = { ...ids, ...passives }; return buildExport; })
    .catch((e) => { buildExportLoading = null; throw e; });
  return buildExportLoading;
}
