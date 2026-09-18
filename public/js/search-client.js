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
    // Glossary terms have no page and no card: the row is a tooltip target only.
    else if (r.keyword) attrs.push('tabindex="0"');
    if (r.cardUrl) attrs.push(`data-card-url="${esc(r.cardUrl)}"`);
    // The .kw hook (with data-keyword) is what the delegated keyword tooltip
    // binds to — put it on the name span so hovering the term shows the definition.
    const nameAttrs = r.keyword
      ? `class="search-result-name kw" data-keyword="${esc(r.keyword)}"`
      : 'class="search-result-name"';
    // Chevron cues a hover submenu/flyout — only affixes have one ("Can roll on"
    // bases). Other hover-only results (augments, glossary terms) show a plain
    // tooltip, no chevron.
    const caret = r.category === 'Affix' && r.cardUrl && !r.url
      ? '<span class="search-result-caret" aria-hidden="true">&rsaquo;</span>' : '';
    return `<a class="search-result-row" ${attrs.join(' ')}>` +
      `<span ${nameAttrs}>${esc(r.name)}</span>` +
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
