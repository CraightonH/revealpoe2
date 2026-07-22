// Controller for the /builds shell: routes location.hash to the pure renderers
// and delegates all actions to the shared store. Rendering logic lives in
// builds-render.js (node-tested); this file is DOM wiring only.
import { getStore, safeWrite } from '/static/js/build-host.js';
import { parseRoute, renderBuild, renderImport } from '/static/js/builds-render.js';
import { modCardSections, renderEditor } from '/static/js/editor-render.js';
import { decodeBuild } from '/static/js/build-code.js';
import { mountEditor } from '/static/js/build-editor.js';

const root = document.querySelector('[data-builds-root]');
const view = root?.querySelector('[data-builds-view]');

if (root && view) {
  const store = getStore();

  // Ref resolution over the search index (lazy: list view never loads it).
  const CATEGORIES = { gem: ['gem', 'support', 'spirit'], unique: ['unique'], base: ['base'] };
  let docsByKey = null;
  let docsArray = null;
  let docsLoading = null;
  function loadDocs() {
    if (docsByKey) return Promise.resolve(docsByKey);
    docsLoading ??= fetch('/static/generated/search-index.json')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((docs) => {
        docsArray = docs;
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
  let planner = null;
  let plannerLoading = null;
  function loadPlanner() {
    if (planner) return Promise.resolve(planner);
    plannerLoading ??= fetch('/static/generated/planner-data.json')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((p) => { planner = p; return p; })
      .catch((e) => { plannerLoading = null; throw e; });
    return plannerLoading;
  }
  let pools = null;
  let poolsLoading = null;
  function loadPools() {
    if (pools) return Promise.resolve(pools);
    poolsLoading ??= fetch('/static/generated/mod-pools.json')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((p) => { pools = p; return p; })
      .catch((e) => { poolsLoading = null; throw e; });
    return poolsLoading;
  }
  const resolveRef = (ref) => {
    for (const cat of CATEGORIES[ref.kind] ?? []) {
      const d = docsByKey?.get(`${cat}:${ref.slug}`);
      if (d) return { name: d.name, iconUrl: d.iconUrl ?? null, url: d.url ?? null, cardUrl: d.cardUrl ?? null };
    }
    return null;
  };

  let importState = null; // cached decode for the current #/import/<code>
  let activeUnmount = null;

  // One build-aware tooltip for filled doll wells: the item's prerendered card
  // + this build's chosen mods. Registered once; reads live build state on show.
  if (window.poe2Tooltips) {
    window.poe2Tooltips.init({
      target: '[data-slot-mods]',
      resolveUrl: function (ref) {
        const slotId = ref.getAttribute('data-slot-mods');
        const route = parseRoute(location.hash);
        const b = route.id ? store.get(route.id) : (importState?.state?.build ?? null);
        const item = b?.gear?.[slotId]?.item;
        return item ? (resolveRef(item)?.cardUrl ?? null) : null;
      },
      // Tailor the wiki item card to a build tooltip: drop the redundant art
      // (the well itself is the art) and splice the chosen mods into the in-game
      // render — corrupted as its own section between requirements and the mod
      // list, like a real corrupted item — rather than tacking a block on the end.
      transform: function (html, ref) {
        if (!pools) return html;
        const slotId = ref.getAttribute('data-slot-mods');
        const route = parseRoute(location.hash);
        const b = route.id ? store.get(route.id) : (importState?.state?.build ?? null);
        const cell = b?.gear?.[slotId];
        if (!cell) return html;
        const box = document.createElement('div');
        box.innerHTML = html;
        box.querySelector('.itemboximage')?.remove(); // redundant with the hovered art
        // Drop wiki-only sections that aren't part of "what you want for this build":
        // the runeforged-variants table and the "Unique versions" cross-reference.
        box.querySelectorAll('.base-card-runeforged, .base-card-uniques').forEach((sec) => {
          const sib = sec.nextElementSibling?.classList.contains('separator') ? sec.nextElementSibling
            : (sec.previousElementSibling?.classList.contains('separator') ? sec.previousElementSibling : null);
          sib?.remove();
          sec.remove();
        });
        // Rarity by chosen explicit-mod count (corrupted implicits don't count):
        // 1–2 → magic (blue), 3+ → rare (yellow), 0 stays normal (white). Uniques
        // keep their own UniquePopup styling.
        const popup = box.querySelector('.newItemPopup.NormalPopup');
        if (popup) {
          const n = Array.isArray(cell.mods) ? cell.mods.length : 0;
          if (n >= 3) popup.classList.replace('NormalPopup', 'RarePopup');
          else if (n >= 1) popup.classList.replace('NormalPopup', 'MagicPopup');
        }
        const { corrupted, mods } = modCardSections(cell, pools);
        if (corrupted || mods) {
          const content = box.querySelector('.content') || box.querySelector('.newItemPopup');
          const reqStats = content && content.querySelector('.requirements')?.closest('.Stats');
          const anchor = reqStats || (content && content.lastElementChild);
          if (anchor) anchor.insertAdjacentHTML('afterend', corrupted + mods);
          else if (content) content.insertAdjacentHTML('beforeend', corrupted + mods);
        }
        return box.innerHTML;
      },
    });
  }

  function render() {
    if (activeUnmount) {
      const unmount = activeUnmount;
      activeUnmount = null;
      unmount();
    }
    const route = parseRoute(location.hash);
    root.classList.toggle('builds-page--editing', route.view !== 'list');
    if (route.view === 'list') {
      // The landing page IS the planner (2026-07-22): jump to the most
      // recently touched build, creating a first empty one on a fresh store.
      // location.replace keeps the redirect out of history so Back leaves
      // the page instead of bouncing.
      importState = null;
      const builds = store.list();
      if (builds.length) {
        const recent = builds.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
        location.replace(`#/b/${encodeURIComponent(recent.id)}`);
        return;
      }
      const b = safeWrite(() => store.create());
      if (b) location.replace(`#/b/${encodeURIComponent(b.id)}`);
      else view.innerHTML = '<p class="builds-load-error">Could not create a build — browser storage is unavailable.</p>';
      return;
    }
    if (route.view === 'build') {
      importState = null;
      const b = store.get(route.id);
      if (!b) { location.hash = ''; return; }
      view.innerHTML = renderBuild(b, resolveRef, pools);
      Promise.all([loadDocs(), loadPlanner(), loadPools()]).then(() => {
        // Mount only if we're still looking at this same build (not a
        // different one, or list/import).
        const cur = parseRoute(location.hash);
        if (cur.view === 'build' && cur.id === route.id) {
          activeUnmount?.();
          activeUnmount = mountEditor(view, route.id, { store, planner, docs: docsArray, resolveRef, pools });
        }
      }).catch(() => {
        const cur = parseRoute(location.hash);
        if (cur.view === 'build' && cur.id === route.id) {
          view.insertAdjacentHTML('beforeend', '<p class="builds-load-error">Editor data could not be loaded. Change routes to retry.</p>');
        }
      });
      return;
    }
    // import view
    if (importState?.code !== route.code) {
      const st = { code: route.code, state: { status: 'loading' }, weaponSet: 1 };
      importState = st;
      // Guard every write with `importState === st` so a stale decode (from a
      // hash that has since moved to a different import code) can't clobber
      // the current importState after this chain settles.
      Promise.all([decodeBuild(route.code), loadDocs().catch(() => null), loadPlanner().catch(() => null), loadPools().catch(() => null)])
        .then(([build]) => { if (importState === st) st.state = { status: 'ready', build }; })
        .catch((e) => {
          if (importState === st) st.state = { status: 'error', message: e?.code === 'bad-version'
            ? 'This code was made by a newer version of the site.'
            : 'The code is damaged or incomplete — recopy the full link.' };
        })
        .finally(() => { if (importState === st) render(); });
    }
    // Same dossier page, read-only: planner data present renders the real
    // thing; without it (fetch failed) fall back to the plain preview.
    if (importState.state.status === 'ready' && planner) {
      view.innerHTML = renderEditor(importState.state.build, {
        planner, resolveRef, weaponSet: importState.weaponSet, mode: 'import',
      });
    } else {
      view.innerHTML = renderImport(importState.state, resolveRef);
    }
  }

  view.addEventListener('click', (e) => {
    const attr = (name) => e.target.closest(`[${name}]`)?.getAttribute(name);
    // Rail anchors: this page routes on location.hash, so a real #gear
    // navigation would bounce to the landing redirect. Scroll instead.
    const rail = e.target.closest('[data-rail-link]');
    if (rail) {
      e.preventDefault();
      view.querySelector(rail.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Weapon-set toggle on the read-only import preview (the editor owns it
    // on the build route).
    const ws = attr('data-weapon-set');
    if (ws && parseRoute(location.hash).view === 'import' && importState?.state.status === 'ready') {
      importState.weaponSet = Number(ws);
      render();
      return;
    }
    if (e.target.closest('[data-builds-new]')) {
      const b = safeWrite(() => store.create());
      if (b) location.hash = `#/b/${encodeURIComponent(b.id)}`;
      return;
    }
    // Rename is handled inline by the editor (build-editor.js) — no
    // window.prompt fallback remains.
    const dup = attr('data-build-duplicate');
    if (dup) {
      safeWrite(() => store.duplicate(dup));
      return;
    }
    const del = attr('data-build-delete');
    if (del) {
      const cur = store.get(del);
      if (cur && window.confirm(`Delete “${cur.name}”? This cannot be undone.`)) safeWrite(() => store.remove(del));
      return;
    }
    if (e.target.closest('[data-import-save]') && importState?.state.status === 'ready') {
      const saved = safeWrite(() => store.create({ ...importState.state.build }));
      if (saved) location.hash = `#/b/${encodeURIComponent(saved.id)}`;
    }
  });

  // Rail scroll-spy — lives here (not the editor mount) so every dossier
  // rendering gets it, including the read-only import view. Viewport-relative
  // rects keep it correct under the S/M/L/XL zoom.
  function spy() {
    const links = view.querySelectorAll('[data-rail-link]');
    if (!links.length) return;
    let current = 'gear';
    for (const id of ['gear', 'skills', 'tree', 'notes']) {
      const el = view.querySelector(`#${id}`);
      if (el && el.getBoundingClientRect().top <= 140) current = id;
    }
    // Pinned at the bottom: the last chapter wins even if it can't reach the top.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = 'notes';
    links.forEach((a) => a.classList.toggle('is-here', a.getAttribute('href') === `#${current}`));
  }
  window.addEventListener('scroll', spy, { passive: true });

  store.subscribe(() => {
    if (activeUnmount && parseRoute(location.hash).view === 'build') {
      // The editor re-renders itself on this same emission (its own
      // subscriber), which resets the rail to the default highlight —
      // re-run the spy after that render settles.
      queueMicrotask(spy);
      return;
    }
    render();
    queueMicrotask(spy);
  });
  window.addEventListener('hashchange', () => { render(); queueMicrotask(spy); });
  render();
}
