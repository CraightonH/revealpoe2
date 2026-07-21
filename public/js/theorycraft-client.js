// Static Theory Crafting master-detail surface. The left table is rendered from
// search-index.json; the shared item-index controller owns selection, history,
// detail fetching/cache, mobile sheets, and arrival motion.
import { GROUPS, groupQuery } from '/static/js/query-core.js';
import { initItemIndex } from '/static/js/item-index.js';

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
  let docs = null;
  let loading = null;

  function load() {
    if (docs) return Promise.resolve(docs);
    if (!loading) {
      input.setAttribute('aria-busy', 'true');
      loading = fetch(INDEX_URL)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((raw) => { docs = raw; return docs; })
        .finally(() => input.removeAttribute('aria-busy'));
    }
    return loading;
  }

  function rowHtml(doc, category) {
    const slug = slugFor(doc);
    const resolver = DETAIL_RESOLVERS[category];
    if (!slug || !resolver) return '';
    const href = doc.url || resolver.url({ ...doc, slug });
    const hint = stripHtml(doc.hint || doc.subtitle || doc.genericText || doc.text);
    const icon = doc.iconUrl
      ? `<img class="gem-index-row__icon item-index-row__icon" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
      : '';
    const uniqueClass = category === 'unique' ? ' item-index-row__name--unique' : '';
    return `<a class="gem-index-row item-index-row tc-index-row item-index-row--${esc(category)}" ` +
      `href="${esc(href)}" data-public-url="${esc(doc.url || href)}" data-item-slug="${esc(slug)}" data-item-name="${esc(doc.name)}" ` +
      `data-item-kind="${esc(category)}"${doc.classSlug ? ` data-class-slug="${esc(doc.classSlug)}"` : ''} style="--row-accent:var(--tc-kind-${esc(category)});">` +
      `<span class="gem-index-row__icon-wrap item-index-row__icon-wrap">${icon}</span>` +
      `<span class="tc-kind-chip search-result-cat search-result-cat--${esc(category)}">${esc(labelFor.get(category) || category)}</span>` +
      '<span class="gem-index-row__identity item-index-row__identity">' +
      `<span class="gem-index-row__name item-index-row__name${uniqueClass}">${esc(doc.name)}</span>` +
      `<span class="gem-index-row__tags item-index-row__tags">${esc(hint)}</span></span>` +
      '<span class="tc-index-row__action" aria-hidden="true"></span></a>';
  }

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
}
