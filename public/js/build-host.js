// public/js/build-host.js
// Browser-only singleton over build-store.js: one store instance shared by
// every importer on a page (builds-page.js, add-to-build.js), wired to the
// cross-tab 'storage' event. Pure modules stay environment-free; this is the
// one place the real localStorage is bound.
import { createStore, STORE_KEY, StoreWriteError } from '/static/js/build-store.js';

let store = null;
export function getStore() {
  if (!store) {
    store = createStore(window.localStorage);
    window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) store.refresh(); });
  }
  return store;
}

/** Run a store mutation; alert (instead of throwing) on quota failure. */
export function safeWrite(fn) {
  try { return fn(); }
  catch (e) {
    if (e instanceof StoreWriteError) { window.alert("Couldn't save — browser storage is full."); return null; }
    throw e;
  }
}
