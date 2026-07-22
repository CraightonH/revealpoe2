// Controller for the /builds shell: routes location.hash to the pure renderers
// and delegates all actions to the shared store. Rendering logic lives in
// builds-render.js (node-tested); this file is DOM wiring only.
import { getStore } from '/static/js/build-host.js';
import { parseRoute, renderList, renderBuild, renderImport } from '/static/js/builds-render.js';
import { decodeBuild } from '/static/js/build-code.js';
import { StoreWriteError } from '/static/js/build-store.js';

const root = document.querySelector('[data-builds-root]');
const view = root?.querySelector('[data-builds-view]');

if (root && view) {
  const store = getStore();

  // Ref resolution over the search index (lazy: list view never loads it).
  const CATEGORIES = { gem: ['gem', 'support', 'spirit'], unique: ['unique'], base: ['base'] };
  let docsByKey = null;
  let docsLoading = null;
  function loadDocs() {
    if (docsByKey) return Promise.resolve(docsByKey);
    docsLoading ??= fetch('/static/generated/search-index.json')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((docs) => {
        docsByKey = new Map();
        for (const d of docs) {
          const key = `${d.category}:${d.slug}`;
          if (!docsByKey.has(key)) docsByKey.set(key, d);
        }
        return docsByKey;
      })
      .catch((e) => { docsLoading = null; throw e; });
    return docsLoading;
  }
  const resolveRef = (ref) => {
    for (const cat of CATEGORIES[ref.kind] ?? []) {
      const d = docsByKey?.get(`${cat}:${ref.slug}`);
      if (d) return { name: d.name, iconUrl: d.iconUrl ?? null, url: d.url ?? null };
    }
    return null;
  };

  let importState = null; // cached decode for the current #/import/<code>

  function render() {
    const route = parseRoute(location.hash);
    if (route.view === 'list') {
      importState = null;
      view.innerHTML = renderList(store.list());
      return;
    }
    if (route.view === 'build') {
      importState = null;
      const b = store.get(route.id);
      if (!b) { location.hash = ''; return; }
      view.innerHTML = renderBuild(b, resolveRef);
      loadDocs().then(() => {
        // Re-render once docs arrive so slugs upgrade to names/icons — but only
        // if we're still looking at this same build (not a different one, or list/import).
        const cur = parseRoute(location.hash);
        if (cur.view === 'build' && cur.id === route.id) view.innerHTML = renderBuild(store.get(cur.id) ?? b, resolveRef);
      }).catch(() => {});
      return;
    }
    // import view
    if (importState?.code !== route.code) {
      const st = { code: route.code, state: { status: 'loading' } };
      importState = st;
      // Guard every write with `importState === st` so a stale decode (from a
      // hash that has since moved to a different import code) can't clobber
      // the current importState after this chain settles.
      Promise.all([decodeBuild(route.code), loadDocs().catch(() => null)])
        .then(([build]) => { if (importState === st) st.state = { status: 'ready', build }; })
        .catch((e) => {
          if (importState === st) st.state = { status: 'error', message: e?.code === 'bad-version'
            ? 'This code was made by a newer version of the site.'
            : 'The code is damaged or incomplete — recopy the full link.' };
        })
        .finally(() => { if (importState === st) render(); });
    }
    view.innerHTML = renderImport(importState.state, resolveRef);
  }

  function reportWriteError(e) {
    if (!(e instanceof StoreWriteError)) throw e;
    window.alert("Couldn't save — browser storage is full.");
  }

  view.addEventListener('click', (e) => {
    const attr = (name) => e.target.closest(`[${name}]`)?.getAttribute(name);
    if (e.target.closest('[data-builds-new]')) {
      try {
        const b = store.create();
        location.hash = `#/b/${encodeURIComponent(b.id)}`;
      } catch (err) { reportWriteError(err); }
      return;
    }
    const rename = attr('data-build-rename');
    if (rename) {
      const cur = store.get(rename);
      const name = cur && window.prompt('Build name', cur.name);
      if (name?.trim()) {
        try { store.update(rename, { name: name.trim() }); } catch (err) { reportWriteError(err); }
      }
      return;
    }
    const dup = attr('data-build-duplicate');
    if (dup) {
      try { store.duplicate(dup); } catch (err) { reportWriteError(err); }
      return;
    }
    const del = attr('data-build-delete');
    if (del) {
      const cur = store.get(del);
      if (cur && window.confirm(`Delete “${cur.name}”? This cannot be undone.`)) store.remove(del);
      return;
    }
    if (e.target.closest('[data-import-save]') && importState?.state.status === 'ready') {
      try {
        const saved = store.create({ ...importState.state.build });
        location.hash = `#/b/${encodeURIComponent(saved.id)}`;
      } catch (err) { reportWriteError(err); }
    }
  });

  store.subscribe(() => render());
  window.addEventListener('hashchange', render);
  render();
}
