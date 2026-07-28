// Controller for the /builds shell: routes location.hash to the pure renderers
// and delegates all actions to the shared store. Rendering logic lives in
// builds-render.js (node-tested); this file is DOM wiring only.
import { getStore, loadItemMath, safeWrite } from '/static/js/build-host.js';
import { parseRoute, renderBuild, renderImport } from '/static/js/builds-render.js';
import { renderEditor, renderSummary } from '/static/js/editor-render.js';
import { itemCardView } from '/static/js/item-card-view.js';
import { loadTradeStatIds, tradeStatIds } from '/static/js/trade-stat-ids.js';
import { decodeGroup } from '/static/js/build-code.js';
import { clampBuild } from '/static/js/build-store.js';
import { mountTreePreview } from '/static/js/tree-preview.js';
import { fillTreeChapter, chapterState } from '/static/js/tree-chapter.js';
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
  // Affix → official trade stat ids, for mod-filtered trade links. Purely
  // additive: if it fails to load, cards keep the plain name/type trade link
  // the server baked in, exactly as before.
  loadTradeStatIds();
  const resolveRef = (ref) => {
    for (const cat of CATEGORIES[ref.kind] ?? []) {
      const d = docsByKey?.get(`${cat}:${ref.slug}`);
      if (d) return { name: d.name, iconUrl: d.iconUrl ?? null, url: d.url ?? null, cardUrl: d.cardUrl ?? null };
    }
    return null;
  };

  let importState = null; // cached decode for the current #/import/<code>
  let activeUnmount = null;
  let itemMath = null;
  let previewApi = null;  // the import view's read-only tree embed
  // Rail Summary collapse — the same per-browser preference the editor persists
  // (build-editor.js SUMMARY_KEY), so the panel doesn't flip state between the
  // build you're editing and a link someone sent you.
  const SUMMARY_KEY = 'reveal.planner.summaryCollapsed';
  let summaryCollapsed = (() => {
    try { return window.localStorage.getItem(SUMMARY_KEY) === '1'; } catch { return false; }
  })();

  // A decoded group has no local ids (the codec strips them), so give each
  // snapshot a stable synthetic id for the variant strip to key on. These never
  // reach storage — importGroup mints real ids on "Copy".
  function sharedSnapshot(st) {
    const { parent, variants } = st.state.group;
    const tagged = {
      parent: { ...parent, id: 'shared:parent' },
      variants: variants.map((v, i) => ({ label: v.label, build: { ...v.build, id: `shared:${i}` } })),
    };
    const id = st.activeId ?? 'shared:parent';
    const found = id === 'shared:parent'
      ? tagged.parent
      : tagged.variants.find((v) => v.build.id === id)?.build ?? tagged.parent;
    return { build: found, group: tagged, id: found.id };
  }

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
      // render. The rewrite itself lives in item-card-view.js, shared with the
      // mod picker's live preview so both show the item identically.
      transform: function (html, ref) {
        if (!pools) return html;
        const slotId = ref.getAttribute('data-slot-mods');
        const route = parseRoute(location.hash);
        const b = route.id ? store.get(route.id) : (importState?.state?.build ?? null);
        const cell = b?.gear?.[slotId];
        if (!cell) return html;
        return itemCardView(html, cell, pools, { dropArt: true, statIds: tradeStatIds() });
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
      Promise.all([loadDocs(), loadPlanner(), loadPools(), loadItemMath()]).then(([, , , math]) => {
        itemMath = math;
        // Mount only if we're still looking at this same build (not a
        // different one, or list/import).
        const cur = parseRoute(location.hash);
        if (cur.view === 'build' && cur.id === route.id) {
          activeUnmount?.();
          activeUnmount = mountEditor(view, route.id, { store, planner, docs: docsArray, resolveRef, pools, itemMath });
        }
      }).catch(() => {
        const cur = parseRoute(location.hash);
        if (cur.view === 'build' && cur.id === route.id) {
          view.insertAdjacentHTML('beforeend', '<p class="builds-load-error">Editor data could not be loaded. Change routes to retry.</p>');
        }
      });
      return;
    }
    // import view — decoded straight from the fragment. NOTHING is written to
    // this visitor's storage until "Copy" (Amendment 3: view first).
    if (importState?.code !== route.code) {
      const st = { code: route.code, state: { status: 'loading' }, weaponSet: 1, activeId: null };
      importState = st;
      // Guard every write with `importState === st` so a stale decode (from a
      // hash that has since moved to a different import code) can't clobber
      // the current importState after this chain settles.
      // itemMath rides along so the shared preview can show the rail Summary —
      // a reader's first question is whether their character could wear this.
      Promise.all([decodeGroup(route.code), loadDocs().catch(() => null), loadPlanner().catch(() => null),
        loadPools().catch(() => null), loadItemMath().catch(() => null)])
        .then(([group, , , , math]) => {
          if (importState !== st) return;
          itemMath ??= math;
          // Clamp for DISPLAY too: the preview renders straight from the
          // fragment, so an oversized code must not break the page before the
          // visitor ever reaches "Copy" (which clamps again in the store).
          const trimmed = [];
          const clampOne = (b) => { const r = clampBuild(b); trimmed.push(...r.trimmed); return r.build; };
          st.state = { status: 'ready', trimmed, group: {
            parent: clampOne(group.parent),
            variants: group.variants.map((v) => ({ label: v.label, build: clampOne(v.build) })),
          } };
        })
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
      const shown = sharedSnapshot(importState);
      const summaryCtx = (treeLines) => ({
        planner, resolveRef, pools, itemMath, treeLines, summaryCollapsed,
        weaponSet: importState.weaponSet, mode: 'import',
        group: shown.group, currentId: shown.id, trimmed: importState.state.trimmed,
      });
      view.innerHTML = renderEditor(shown.build, summaryCtx(importState.treeLines ?? []));
      // The tree is pivotal to a build, so a shared link shows it without asking.
      // Dynamic import: the rest of the preview has already painted by now.
      // Same identity plumbing as the editor: the embed needs the GGG class name
      // and ascendancy id, which our slugs are not.
      const shownCls = (planner?.classes ?? []).find((c) => c.slug === shown.build?.class) ?? null;
      previewApi = null;   // the old embed died with the innerHTML above
      mountTreePreview(view.querySelector('[data-tree-preview-mount]'), shown.build?.tree?.code ?? null, {
        className: shownCls?.name ?? null,
        ascId: shownCls?.ascendancies.find((a) => a.slug === shown.build?.ascendancy)?.gggId ?? null,
        // The tree's own stat lines land only once the embed is up. Patch the
        // Summary in place rather than re-rendering — a full render would tear
        // down the embed that just finished mounting. Without this the shared
        // build's life/resistances would silently omit everything from the tree.
        // statLinesReady first: the stat-line artifact loads lazily, so reading
        // straight from onReady returns [] and the tree's contribution silently
        // vanishes from the totals.
        onReady: (api) => {
          previewApi = api;
          // Same Passive Tree chapter the editor shows — points strip + Notable
          // Priority — but fixed: a reader sees the author's order, not handles.
          fillTreeChapter(view, api, { ...chapterState(api, shown.build), readonly: true });
          api?.statLinesReady?.().then(() => {
            const lines = api?.getAllocatedStatLines?.() ?? [];
            if (!lines.length || importState?.state.status !== 'ready') return;
            importState.treeLines = lines;
            const box = document.createElement('div');
            box.innerHTML = renderSummary(shown.build, summaryCtx(lines));
            const next = box.firstElementChild;
            const cur = view.querySelector('[data-summary]');
            if (next && cur) cur.replaceWith(next);
          });
        },
      });
    } else if (importState.state.status === 'ready') {
      view.innerHTML = renderImport({ status: 'ready', build: importState.state.group.parent }, resolveRef);
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
    // Click a notable-priority tile to find it in the tree: the embed centres on
    // the node and pulses it. Same affordance the editor has; a reader following
    // someone's build needs it most.
    const prioRow = e.target.closest('[data-prio-row]');
    if (prioRow && previewApi) {
      previewApi.focusNode(Number(prioRow.getAttribute('data-prio-row')));
      view.querySelector('[data-tree-preview-mount]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Summary collapse on the import preview (the editor owns it on the build
    // route). Toggled in place — a re-render would tear down the tree embed.
    if (e.target.closest('[data-summary-toggle]') && parseRoute(location.hash).view === 'import') {
      e.preventDefault();
      summaryCollapsed = !summaryCollapsed;
      try { window.localStorage.setItem(SUMMARY_KEY, summaryCollapsed ? '1' : '0'); } catch { /* storage may be unavailable */ }
      const panel = view.querySelector('[data-summary]');
      panel?.classList.toggle('collapsed', summaryCollapsed);
      panel?.querySelector('[data-summary-toggle]')?.setAttribute('aria-expanded', String(!summaryCollapsed));
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
    const vtab = attr('data-variant-tab');
    if (vtab && parseRoute(location.hash).view === 'import' && importState?.state.status === 'ready') {
      importState.activeId = vtab;
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
      if (!cur) return;
      // Deleting a PARENT keeps its variants (they are standalone builds). Say so:
      // they all share the parent's title, so they would otherwise resurface in the
      // switcher as unexplained duplicates of the thing you just deleted.
      const kids = (cur.variants ?? []).length;
      const extra = kids
        ? `\n\nIts ${kids} variant${kids > 1 ? 's' : ''} will be kept as separate builds.`
        : '';
      if (window.confirm(`Delete “${cur.name}”? This cannot be undone.${extra}`)) {
        safeWrite(() => store.remove(del));
      }
      return;
    }
    if (e.target.closest('[data-import-save]') && importState?.state.status === 'ready') {
      const saved = safeWrite(() => store.importGroup(importState.state.group));
      if (saved) location.hash = `#/b/${encodeURIComponent(saved.id)}`;
    }
  });

  // Hovering a priority tile tints its node in the tree, so you can locate it
  // without committing to a click.
  view.addEventListener('pointerover', (e) => {
    const row = e.target.closest?.('[data-prio-row]');
    if (row) previewApi?.setHighlight([Number(row.getAttribute('data-prio-row'))]);
  });
  view.addEventListener('pointerout', (e) => {
    const row = e.target.closest?.('[data-prio-row]');
    if (row && !row.contains(e.relatedTarget)) previewApi?.setHighlight(null);
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
