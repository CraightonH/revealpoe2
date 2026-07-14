// Client-side Theory Crafting results. Replaces the /theorycraft/results route
// on the static site: strips htmx from the .tc-input, runs the shared grouping
// core over the prebuilt search index, and renders each result by reusing the
// real browse-card HTML from browse-cards.json (compact fallback for affixes /
// missing cards). Markup mirrors views/partials/theorycraft-results.njk.
import { groupQuery } from '/static/js/query-core.js';

const INDEX_URL = '/static/generated/search-index.json';
const CARDS_URL = '/static/generated/browse-cards.json';

const input = document.querySelector('.tc-input');
const target = document.querySelector('#tc-results');

if (input && target) {
  input.removeAttribute('hx-get');
  input.removeAttribute('hx-trigger');
  input.removeAttribute('hx-target');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let data = null;     // { docs, cards }
  let loading = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = Promise.all([
        fetch(INDEX_URL).then((r) => r.json()),
        fetch(CARDS_URL).then((r) => r.json()),
      ]).then(([docs, cards]) => { data = { docs, cards }; return data; });
    }
    return loading;
  }

  // gem/support/spirit all read the gem card set, matching the server's
  // cardMapFor(); other categories key by their own name.
  function cardFor(cards, category, slug) {
    const bucket = (category === 'support' || category === 'spirit') ? 'gem' : category;
    return cards[bucket] ? cards[bucket][slug] : undefined;
  }

  function compactCard(it, category) {
    const cardUrl = it.cardUrl || (it.url ? it.url + '/card' : null);
    const attrs = [`class="tc-result-card tc-result-card--${esc(category)}"`];
    if (it.url) attrs.push(`href="${esc(it.url)}"`);
    else if (cardUrl) attrs.push('tabindex="0"', 'role="button"');
    if (cardUrl) attrs.push(`data-card-url="${esc(cardUrl)}"`);
    const icon = it.iconUrl
      ? `<img class="tc-result-icon" src="${esc(it.iconUrl)}" alt="${esc(it.name)}" loading="lazy" onerror="this.style.visibility='hidden'">`
      : '';
    const sub = it.subtitle ? `<span class="tc-result-sub">${esc(it.subtitle)}</span>` : '';
    return `<a ${attrs.join(' ')}>${icon}<span class="tc-result-name">${esc(it.name)}</span>${sub}</a>`;
  }

  function resultCard(cards, it, category) {
    return cardFor(cards, category, it.slug) || compactCard(it, category);
  }

  function gridClass(category) {
    if (category === 'gem' || category === 'support' || category === 'spirit') return 'gem-browse-grid';
    if (category === 'unique' || category === 'base') return 'bases-list-grid';
    if (category === 'keystone' || category === 'notable') return 'tc-passive-grid';
    if (category === 'augment') return 'augment-grid';
    return 'tc-result-grid';
  }

  const EMPTY_PROMPT =
    '<div class="tc-empty">' +
    '<p>Search across gems, supports, uniques, affixes, keystones, notables and bases.</p>' +
    '<p class="tc-examples">Examples: <code>onslaught</code> &middot; <code>type:support cold</code> &middot; ' +
    '<code>color:green tag:attack</code> &middot; <code>-type:unique chaos resistance</code></p></div>';

  function renderResult(cards, result) {
    if (result.empty) return EMPTY_PROMPT;
    if (!result.groups.length) {
      return `<div class="tc-empty"><p>No results for <code>${esc(result.query)}</code>.</p></div>`;
    }
    let html = `<div class="tc-summary">${result.total} result${result.total !== 1 ? 's' : ''} ` +
      `for <code>${esc(result.query)}</code></div>`;
    for (const g of result.groups) {
      const cardsHtml = g.items.map((it) => resultCard(cards, it, g.category)).join('');
      const more = g.shown < g.total ? `<p class="tc-more">Showing ${g.shown} of ${g.total}</p>` : '';
      html += '<section class="tc-group">' +
        `<h2 class="tc-group-heading">${esc(g.label)} (${g.total})</h2>` +
        `<div class="${gridClass(g.category)}">${cardsHtml}</div>${more}</section>`;
    }
    return html;
  }

  function run(q) {
    load().then(({ docs, cards }) => {
      if (input.value === q) target.innerHTML = renderResult(cards, groupQuery(q, { docs }));
    });
  }

  let timer = null;
  input.addEventListener('input', () => {
    const q = input.value;
    // Keep the URL shareable without spamming history.
    const next = q ? `?q=${encodeURIComponent(q)}` : location.pathname;
    history.replaceState(null, '', next);
    clearTimeout(timer);
    timer = setTimeout(() => run(q), 200);
  });

  // Deep link: render immediately for a ?q= URL (or a server-prefilled value).
  const initial = new URLSearchParams(location.search).get('q');
  if (initial !== null && initial !== input.value) input.value = initial;
  if (input.value.trim()) run(input.value);
}
