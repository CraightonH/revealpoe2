// Client-side global search dropdown. On the static site there is no /search
// route, so this takes over the header search input: it strips the htmx
// attributes (before htmx binds) and renders the dropdown from the prebuilt
// search index using the SAME ranking core the server uses. Markup mirrors
// views/partials/search-results.njk exactly.
import { toSearchDocs, searchRank } from '/static/js/query-core.js';

const INDEX_URL = '/static/generated/search-index.json';

const input = document.querySelector('.search-box input[type="search"]');
const target = document.querySelector('#search-results');

if (input && target) {
  // Strip htmx wiring synchronously (deferred module code runs before htmx
  // processes the DOM on DOMContentLoaded), so htmx never fires /search.
  input.removeAttribute('hx-get');
  input.removeAttribute('hx-trigger');
  input.removeAttribute('hx-target');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let docs = null;       // toSearchDocs(index), built once
  let loading = null;    // in-flight load promise

  function load() {
    if (docs) return Promise.resolve(docs);
    if (!loading) {
      loading = fetch(INDEX_URL)
        .then((r) => r.json())
        .then((raw) => { docs = toSearchDocs(raw); return docs; });
    }
    return loading;
  }

  function rowHtml(r) {
    const attrs = [];
    if (r.url) attrs.push(`href="${esc(r.url)}"`);
    else if (r.cardUrl) attrs.push('tabindex="0"', 'role="button"');
    if (r.cardUrl) attrs.push(`data-card-url="${esc(r.cardUrl)}"`);
    const caret = r.cardUrl && !r.url
      ? '<span class="search-result-caret" aria-hidden="true">&rsaquo;</span>' : '';
    return `<a class="search-result-row" ${attrs.join(' ')}>` +
      `<span class="search-result-name">${esc(r.name)}</span>` +
      `<span class="search-result-cat search-result-cat--${esc(String(r.category).toLowerCase())}">${esc(r.category)}</span>` +
      `${caret}</a>`;
  }

  function render(q, results) {
    if (!q) { target.innerHTML = ''; return; }
    const rows = results.map(rowHtml).join('');
    const all = `<a href="/theorycraft?q=${encodeURIComponent(q)}" class="search-result-row search-result-all">` +
      `<span class="search-result-name"><kbd>↵</kbd> Search everything for “${esc(q)}”</span>` +
      '<span class="search-result-cat">→</span></a>';
    target.innerHTML = `<div class="search-results">${rows}${all}</div>`;
  }

  let timer = null;
  function onInput() {
    const q = input.value.trim();
    if (!q) { render('', []); return; }
    load().then((d) => {
      // Ignore a stale resolve if the box was cleared while loading.
      if (input.value.trim() === q) render(q, searchRank(d, q));
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(onInput, 200);  // matches the old htmx "delay:200ms"
  });
  // Warm the index on first focus so the first keystroke renders instantly.
  input.addEventListener('focus', load, { once: true });
}
