// Static Theory Crafting master-detail surface. The left table is rendered from
// search-index.json; the shared item-index controller owns selection, history,
// detail fetching/cache, mobile sheets, and arrival motion.
import { GROUPS, groupQuery } from '/static/js/query-core.js';
import { initItemIndex } from '/static/js/item-index.js';
import { createPinStore, pinKey } from '/static/js/pin-store.js';
import { openBuildMenu } from '/static/js/add-to-build.js';

const INDEX_URL = '/static/generated/search-index.json';

// The only category -> detail-source registry. Adding a future kind requires a
// row here (plus its label in query-core GROUPS), not another controller branch.
const DETAIL_RESOLVERS = {
  gem:      { url: (doc) => `/gem/${doc.slug}`, selector: '.gem-detail' },
  support:  { url: (doc) => `/gem/${doc.slug}`, selector: '.gem-detail' },
  spirit:   { url: (doc) => `/gem/${doc.slug}`, selector: '.gem-detail' },
  unique:   { url: (doc) => `/unique/${doc.slug}`, selector: '.item-detail' },
  // Bases show their CLASS detail (mods/augments — same as the /bases index),
  // not the per-base tooltip page; classSlug is on every base doc.
  base:     { url: (doc) => `/bases/${doc.classSlug || doc.slug}`, selector: '.item-detail' },
  keystone: { url: (doc) => `/keystone/${doc.slug}`, selector: '.item-detail' },
  notable:  { url: (doc) => `/notable/${doc.slug}`, selector: '.item-detail' },
  affix:    { url: (doc) => `/mod/${doc.slug}/card`, selector: null },
  augment:  { url: (doc) => `/augment/${doc.slug}/card`, selector: null },
};

const root = document.querySelector('.theorycraft-index');
const input = root?.querySelector('.tc-input');
const target = root?.querySelector('#tc-results');

if (root && input && target) {
  input.removeAttribute('hx-get');
  input.removeAttribute('hx-trigger');
  input.removeAttribute('hx-target');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const labelFor = new Map(GROUPS.map((group) => [group.category, group.label]));
  const slugFor = (doc) => doc.category === 'affix' ? doc.typeSlug : doc.slug;
  const pinIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 3.5h7.6l-1.4 5.1 3.1 3.2v1.7H13V21l-2-2v-5.5H6.5v-1.7l3.1-3.2-1.4-5.1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const pinStore = createPinStore();
  const tray = root.querySelector('[data-tc-pin-tray]');
  const trayItems = root.querySelector('[data-tc-pin-items]');
  const trayCount = root.querySelector('[data-tc-pin-count]');
  const trayViewport = root.querySelector('[data-tc-pin-viewport]');
  const clearButton = root.querySelector('[data-tc-pin-clear]');
  const notice = root.querySelector('[data-tc-pin-notice]');
  const proxyContainer = document.createElement('div');
  proxyContainer.className = 'tc-pin-proxies';
  proxyContainer.hidden = true;
  root.append(proxyContainer);
  root.classList.add('tc-pins-ready');
  let docs = null;
  let loading = null;
  let resolvedPins = [];
  let clearTimer = 0;

  function load() {
    if (docs) return Promise.resolve(docs);
    if (!loading) {
      input.setAttribute('aria-busy', 'true');
      loading = fetch(INDEX_URL)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((raw) => {
          docs = raw;
          resolvePins(true);
          return docs;
        })
        .finally(() => input.removeAttribute('aria-busy'));
    }
    return loading;
  }

  function rowHtml(doc, category, options = {}) {
    const slug = slugFor(doc);
    const resolver = DETAIL_RESOLVERS[category];
    if (!slug || !resolver) return '';
    const href = doc.url || resolver.url({ ...doc, slug });
    const hint = stripHtml(doc.hint || doc.subtitle || doc.genericText || doc.text);
    const icon = doc.iconUrl
      ? `<img class="gem-index-row__icon item-index-row__icon" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
      : '';
    const uniqueClass = category === 'unique' ? ' item-index-row__name--unique' : '';
    return `<a class="gem-index-row item-index-row tc-index-row item-index-row--${esc(category)}${options.proxy ? ' tc-pin-proxy' : ''}" ` +
      `href="${esc(href)}" data-public-url="${esc(doc.url || href)}" data-item-slug="${esc(slug)}" data-item-name="${esc(doc.name)}" ` +
      `data-item-kind="${esc(category)}"${doc.classSlug ? ` data-class-slug="${esc(doc.classSlug)}"` : ''} style="--row-accent:var(--tc-kind-${esc(category)});">` +
      `<span class="gem-index-row__icon-wrap item-index-row__icon-wrap">${icon}</span>` +
      `<span class="tc-kind-chip search-result-cat search-result-cat--${esc(category)}">${esc(labelFor.get(category) || category)}</span>` +
      '<span class="gem-index-row__identity item-index-row__identity">' +
      `<span class="gem-index-row__name item-index-row__name${uniqueClass}">${esc(doc.name)}</span>` +
      `<span class="gem-index-row__tags item-index-row__tags">${esc(hint)}</span></span>` +
      (options.proxy ? '' : `<span class="tc-index-row__action"><button class="tc-pin-toggle tc-row-pin" type="button" data-tc-pin-toggle aria-pressed="false" aria-label="Pin ${esc(doc.name)}">${pinIcon}</button></span>`) +
      '</a>';
  }

  function refForDoc(doc) {
    const ref = { category: doc.category, slug: slugFor(doc) };
    if (doc.category === 'base' && doc.classSlug) ref.classSlug = doc.classSlug;
    return ref;
  }

  function refForRow(row) {
    const ref = { category: row.dataset.itemKind, slug: row.dataset.itemSlug };
    if (ref.category === 'base' && row.dataset.classSlug) ref.classSlug = row.dataset.classSlug;
    return ref;
  }

  function docForRef(ref) {
    return docs?.find((doc) => pinKey(refForDoc(doc)) === pinKey(ref) &&
      (ref.category !== 'base' || !ref.classSlug || doc.classSlug === ref.classSlug)) || null;
  }

  function updateOverflow() {
    if (!trayViewport || tray.hidden) return;
    const overflowing = trayViewport.scrollWidth > trayViewport.clientWidth + 1;
    trayViewport.classList.toggle('is-overflowing', overflowing);
    trayViewport.classList.toggle('is-at-start', trayViewport.scrollLeft <= 1);
    trayViewport.classList.toggle('is-at-end', trayViewport.scrollLeft + trayViewport.clientWidth >= trayViewport.scrollWidth - 1);
  }

  function showRemovedNotice(count) {
    if (!notice || !count) return;
    notice.hidden = false;
    notice.innerHTML = `<span>${count} pinned items no longer exist and were removed</span>` +
      '<button type="button" data-tc-pin-notice-dismiss aria-label="Dismiss notice">×</button>';
  }

  function renderPins() {
    const refs = pinStore.getRefs();
    root.querySelectorAll('[data-tc-pin-toggle]').forEach((button) => {
      const row = button.closest('.tc-index-row');
      if (!row) return;
      const pinned = pinStore.isPinned(refForRow(row));
      button.innerHTML = pinIcon;
      button.setAttribute('aria-pressed', String(pinned));
      button.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${row.dataset.itemName}`);
    });

    proxyContainer.innerHTML = resolvedPins.map(({ doc }) => rowHtml(doc, doc.category, { proxy: true })).join('');
    tray.hidden = resolvedPins.length === 0;
    trayCount.textContent = resolvedPins.length;
    trayItems.innerHTML = resolvedPins.map(({ ref, doc }) => {
      const icon = doc.iconUrl ? `<img src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '';
      return `<div class="tc-pin-chip" role="button" tabindex="0" data-tc-pin-select data-item-kind="${esc(ref.category)}" data-item-slug="${esc(ref.slug)}" ` +
        `style="--row-accent:var(--tc-kind-${esc(ref.category)});" aria-label="Select ${esc(doc.name)}">` +
        `<span class="tc-pin-chip__icon">${icon}</span><span class="tc-pin-chip__name">${esc(doc.name)}</span>` +
        `<button class="tc-pin-chip__remove" type="button" data-tc-pin-remove aria-label="Unpin ${esc(doc.name)}">×</button></div>`;
    }).join('');
    syncDetailPins();
    requestAnimationFrame(updateOverflow);
    if (!refs.length) resetClearConfirmation();
  }

  function resolvePins(refreshHash = false) {
    if (!docs) {
      renderPins();
      return;
    }
    const result = pinStore.resolve(docs);
    resolvedPins = result.resolved;
    if (result.removed) showRemovedNotice(result.removed);
    renderPins();
    if (refreshHash) root.dispatchEvent(new CustomEvent('item-index:rows-changed'));
  }

  function refFromHash() {
    const hash = location.hash.slice(1);
    const split = hash.indexOf(':');
    if (split < 1) return null;
    let slug;
    try { slug = decodeURIComponent(hash.slice(split + 1)); } catch { return null; }
    const ref = { category: hash.slice(0, split), slug };
    const doc = docForRef(ref);
    return doc ? refForDoc(doc) : null;
  }

  function syncDetailPins() {
    const ref = refFromHash();
    const doc = ref ? docForRef(ref) : null;
    const detailTitle = root.querySelector('[data-tc-detail-title]');
    if (detailTitle) detailTitle.textContent = doc?.name || 'Result details';
    root.querySelectorAll('[data-tc-detail-pin]').forEach((button) => {
      button.innerHTML = pinIcon;
      button.hidden = !ref;
      if (!ref) return;
      const pinned = pinStore.isPinned(ref);
      button.setAttribute('aria-pressed', String(pinned));
      button.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${doc?.name || 'selected result'}`);
    });
  }

  function resetClearConfirmation() {
    window.clearTimeout(clearTimer);
    clearButton.classList.remove('is-confirming');
    clearButton.textContent = 'Clear all';
  }

  function toggleRef(ref) {
    if (ref) pinStore.toggle(ref);
  }

  // Registered before the shared row controller so a pin click cannot also
  // become a row selection click.
  root.addEventListener('click', (event) => {
    const rowPin = event.target.closest('[data-tc-pin-toggle]');
    if (rowPin) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const row = rowPin.closest('.tc-index-row');
      if (row) toggleRef(refForRow(row));
      return;
    }
    const detailPin = event.target.closest('[data-tc-detail-pin]');
    if (detailPin) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleRef(refFromHash());
      return;
    }
    const remove = event.target.closest('[data-tc-pin-remove]');
    if (remove) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pinStore.remove(refForRow(remove.closest('[data-tc-pin-select]')));
      return;
    }
    const chip = event.target.closest('[data-tc-pin-select]');
    if (chip) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const ref = refForRow(chip);
      const proxy = Array.from(proxyContainer.querySelectorAll('.tc-pin-proxy')).find((row) => pinKey(refForRow(row)) === pinKey(ref));
      proxy?.click();
      queueMicrotask(syncDetailPins);
      return;
    }
    if (event.target.closest('[data-tc-pin-promote]')) {
      event.preventDefault();
      const KIND = { gem: 'gem', support: 'gem', spirit: 'gem', unique: 'unique', base: 'base' };
      const refs = resolvedPins
        .filter(({ ref }) => KIND[ref.category])
        .map(({ ref }) => ({ kind: KIND[ref.category], slug: ref.slug }));
      if (!refs.length) {
        notice.hidden = false;
        notice.innerHTML = '<span>Only gems, uniques, and bases can go in a build — no pinned items qualify.</span>' +
          '<button type="button" data-tc-pin-notice-dismiss aria-label="Dismiss notice">×</button>';
        return;
      }
      openBuildMenu(event.target.closest('[data-tc-pin-promote]'), refs);
      return;
    }
    if (event.target.closest('[data-tc-pin-clear]')) {
      event.preventDefault();
      if (clearButton.classList.contains('is-confirming')) pinStore.clear();
      else {
        clearButton.classList.add('is-confirming');
        clearButton.textContent = 'Confirm clear';
        clearTimer = window.setTimeout(resetClearConfirmation, 3000);
      }
      return;
    }
    if (event.target.closest('[data-tc-pin-notice-dismiss]')) {
      notice.hidden = true;
      notice.innerHTML = '';
      return;
    }
    if (event.target.closest('.tc-index-row')) queueMicrotask(syncDetailPins);
  });

  root.addEventListener('keydown', (event) => {
    const chip = event.target.closest('[data-tc-pin-select]');
    if (!chip || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    chip.click();
  });
  trayViewport?.addEventListener('scroll', updateOverflow, { passive: true });
  window.addEventListener('resize', updateOverflow);
  window.addEventListener('hashchange', () => queueMicrotask(syncDetailPins));
  pinStore.subscribe(() => resolvePins());
  renderPins();

  function renderResult(result) {
    if (result.empty) {
      target.innerHTML = '<div class="tc-empty tc-empty--initial"><p>Search across gems, supports, uniques, affixes, keystones, notables, bases, and augments.</p><p>Choose an example above or combine search terms to begin.</p></div>';
    } else if (!result.groups.length) {
      target.innerHTML = `<div class="tc-empty"><p>No results for <code>${esc(result.query)}</code>.</p></div>`;
    } else {
      target.innerHTML = result.groups.map((group) => {
        const rows = group.items.map((doc) => rowHtml(doc, group.category)).join('');
        const more = group.shown < group.total ? `<p class="tc-more">Showing ${group.shown} of ${group.total}</p>` : '';
        return `<section class="tc-index-group" data-result-category="${esc(group.category)}">` +
          `<h2 class="tc-index-group__heading"><span>${esc(group.label)}</span><span>${group.total}</span></h2>` +
          `${rows}${more}</section>`;
      }).join('');
    }
    root.querySelectorAll('[data-filter-count], [data-tc-result-count]').forEach((node) => { node.textContent = result.total; });
    const help = root.querySelector('.tc-help');
    if (help) help.open = result.empty;
    renderPins();
    root.dispatchEvent(new CustomEvent('item-index:rows-changed'));
  }

  function run(query) {
    const requested = query;
    load().then((indexDocs) => {
      if (input.value === requested) renderResult(groupQuery(requested, { docs: indexDocs }));
    }).catch(() => {
      if (input.value === requested) target.innerHTML = '<div class="tc-empty"><p>The search index could not be loaded.</p></div>';
    });
  }

  const identity = (row) => `${row.dataset.itemKind}:${row.dataset.itemSlug}`;
  initItemIndex({
    rootSelector: '.theorycraft-index',
    rowSelector: '.tc-index-row[data-item-kind][data-item-slug]',
    slugDataKey: 'itemSlug',
    nameDataKey: 'itemName',
    identityForRow: identity,
    hashForRow: identity,
    identityFromHash(hash) {
      const split = hash.indexOf(':');
      if (split < 1) return null;
      return `${hash.slice(0, split)}:${decodeURIComponent(hash.slice(split + 1))}`;
    },
    detailResolver(row) {
      const resolver = DETAIL_RESOLVERS[row.dataset.itemKind];
      return resolver ? { url: resolver.url({ slug: row.dataset.itemSlug, classSlug: row.dataset.classSlug }), selector: resolver.selector } : null;
    },
    // Cross-links stay in this workspace only when their new public index URL
    // matches a target already present in the current result table.
    identityForDetailLink(anchor) {
      let url;
      try { url = new URL(anchor.href, location.href); } catch { return null; }
      if (url.origin !== location.origin) return null;
      // Passive-tree links always navigate — the tree is its own surface, and a
      // notable's public URL would otherwise match its own row and eat the click.
      if (url.pathname === '/passives') return null;
      const target = `${url.pathname}${url.search}${url.hash}`;
      const row = Array.from(root.querySelectorAll('.tc-index-row')).find((candidate) => {
        const publicUrl = new URL(candidate.dataset.publicUrl, location.href);
        return `${publicUrl.pathname}${publicUrl.search}${publicUrl.hash}` === target;
      });
      return row ? identity(row) : null;
    },
    noun: 'result',
    plural: 'results',
    widgetInitializers: ['initGemLevelSelect', 'initGemQualityInput', 'initScalingToggle'],
  });

  let timer = null;
  input.addEventListener('input', () => {
    const query = input.value;
    const url = new URL(location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    clearTimeout(timer);
    timer = setTimeout(() => run(query), 200);
  });

  const initial = new URLSearchParams(location.search).get('q');
  if (initial !== null && initial !== input.value) input.value = initial;
  if (input.value.trim()) run(input.value);
  else load().catch(() => {});
}
