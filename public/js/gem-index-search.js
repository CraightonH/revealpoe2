// Progressive local full-text search for the /gems master list. The prebuilt
// document set and shared query core are the same artifacts used by global
// search and server-side Theory Crafting; rows are joined to docs by gem slug.
import { parseQuery, docMatches } from '/static/js/query-core.js';

const INDEX_URL = '/static/generated/search-index.json';
const GEM_CATEGORIES = new Set(['gem', 'support', 'spirit']);

const root = document.querySelector('.gem-index');
const input = root?.querySelector('[data-gem-index-search]');

if (root && input) {
  const rows = Array.from(root.querySelectorAll('.gem-index-row[data-gem-slug]'));
  const rowsContainer = root.querySelector('.gem-index-rows');
  const count = root.querySelector('[data-filter-count]');
  const empty = root.querySelector('[data-gem-index-empty]');
  const clearButton = root.querySelector('[data-gem-search-clear]');
  const filterVisible = new Map();
  let docs = null;
  let loading = null;
  let timer = null;
  let queryVersion = 0;
  let activeMatchedSlugs = new Set();
  let activeHasQuery = false;

  function loadIndex() {
    if (docs) return Promise.resolve(docs);
    if (!loading) {
      input.setAttribute('aria-busy', 'true');
      loading = fetch(INDEX_URL)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((raw) => {
          docs = raw.filter((doc) => GEM_CATEGORIES.has(doc.category));
          return docs;
        })
        .finally(() => input.removeAttribute('aria-busy'));
    }
    return loading;
  }

  function captureFilterVisibility() {
    rows.forEach((row) => filterVisible.set(row, row.style.display !== 'none'));
  }

  function renderMatches(matchedSlugs, hasQuery) {
    let shown = 0;
    rows.forEach((row) => {
      const searchMatch = !hasQuery || matchedSlugs.has(row.dataset.gemSlug);
      const visible = filterVisible.get(row) !== false && searchMatch;
      row.style.display = visible ? '' : 'none';
      if (visible) shown++;
    });
    if (count) count.textContent = shown;
    if (rowsContainer) rowsContainer.hidden = hasQuery && shown === 0;
    if (empty) empty.hidden = !hasQuery || shown !== 0;
  }

  function commitMatches(matchedSlugs, hasQuery) {
    activeMatchedSlugs = matchedSlugs;
    activeHasQuery = hasQuery;
    renderMatches(activeMatchedSlugs, activeHasQuery);
  }

  function applyQuery(query, gemDocs) {
    const terms = parseQuery(query).terms;
    const matchedSlugs = new Set(
      terms.length
        ? gemDocs.filter((doc) => docMatches(doc, terms)).map((doc) => doc.slug)
        : [],
    );
    commitMatches(matchedSlugs, terms.length > 0);
  }

  function clearSearch() {
    clearTimeout(timer);
    queryVersion++;
    input.value = '';
    commitMatches(new Set(), false);
  }

  function runSearch() {
    const query = input.value.trim();
    const version = ++queryVersion;
    if (!query) {
      commitMatches(new Set(), false);
      return;
    }
    loadIndex()
      .then((gemDocs) => {
        if (version === queryVersion && input.value.trim() === query) applyQuery(query, gemDocs);
      })
      .catch(() => {
        // A failed enhancement must leave the server-rendered/filter-bar list usable.
        if (version === queryVersion) commitMatches(new Set(), false);
      });
  }

  // filter-bar.js owns chip matching. Capture its result, then intersect the
  // current text query without duplicating that engine's rules here.
  captureFilterVisibility();
  root.addEventListener('filter-bar:applied', () => {
    captureFilterVisibility();
    renderMatches(activeMatchedSlugs, activeHasQuery);
  });

  input.addEventListener('focus', () => { loadIndex().catch(() => {}); }, { once: true });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 200);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    clearSearch();
  });
  clearButton?.addEventListener('click', () => {
    clearSearch();
    input.focus();
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (event.key !== '/' || editing || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    input.focus();
  });
}
