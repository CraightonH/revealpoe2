import { parseQuery, docMatches } from '/static/js/query-core.js';

const INDEX_URL = '/static/generated/search-index.json';

// Shared progressive controller for the gem, unique, and base indexes. Page
// modules supply only vocabulary and routing/data hooks; every interaction and
// fetch-state transition lives here.
export function initItemIndex(config) {
  const root = document.querySelector(config.rootSelector || '.item-index');
  if (!root) return;

  const rowSelector = config.rowSelector || '.item-index-row[data-item-slug]';
  const slugKey = config.slugDataKey || 'itemSlug';
  const nameKey = config.nameDataKey || 'itemName';
  const detailSelector = config.detailContentSelector || '.item-detail';
  const pathPrefix = config.detailPathPrefix;
  const indexPath = config.indexPath || null;
  const categories = new Set(config.searchIndexCategories || []);
  const resultSlugKey = config.searchResultSlugDataKey || null;
  const rowTextKey = config.searchRowTextDataKey || null;
  const noun = config.noun || 'item';
  const plural = config.plural || `${noun}s`;
  const searchEvent = config.visibilityResetEvent || 'item-index:visibility-reset';
  const desktop = window.matchMedia('(min-width: 900px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pane = root.querySelector('.item-index-pane');
  const paneContent = root.querySelector('.item-index-pane__content');
  const paneStatus = root.querySelector('.item-index-pane__status');
  const sheet = root.querySelector('.item-index-sheet');
  const sheetContent = root.querySelector('.item-index-sheet__content');
  const sheetStatus = root.querySelector('.item-index-sheet__status');
  const sheetTitle = root.querySelector('.item-index-sheet__title');
  const sheetClose = root.querySelector('.item-index-sheet__close');
  const scrim = root.querySelector('.item-index-sheet-scrim');
  const cache = new Map();
  let requestId = 0;
  let arrivalTimer = 0;
  let arrivingRow = null;
  let lastHandledHash = null;
  let lastSheetTrigger = null;

  const rows = () => Array.from(root.querySelectorAll(rowSelector));
  const slugOf = (row) => row.dataset[slugKey];
  const nameOf = (row) => row.dataset[nameKey];
  const identityOf = config.identityForRow || slugOf;

  function rowForIdentity(identity) {
    return rows().find((row) => identityOf(row) === identity) || null;
  }

  function rowForHash() {
    let identity;
    try {
      identity = config.identityFromHash
        ? config.identityFromHash(window.location.hash.slice(1))
        : decodeURIComponent(window.location.hash.slice(1));
    } catch { return null; }
    return identity ? rowForIdentity(identity) : null;
  }

  function rowForDetailLink(anchor) {
    if (config.identityForDetailLink) {
      const identity = config.identityForDetailLink(anchor);
      return identity ? rowForIdentity(identity) : null;
    }
    if (!pathPrefix) return null;
    let url;
    try { url = new URL(anchor.href, window.location.href); } catch { return null; }
    if (url.origin !== window.location.origin) return null;
    if (indexPath && url.pathname === indexPath && url.hash) {
      let identity;
      try {
        identity = config.identityFromHash
          ? config.identityFromHash(url.hash.slice(1))
          : decodeURIComponent(url.hash.slice(1));
      } catch { return null; }
      return identity ? rowForIdentity(identity) : null;
    }
    const escaped = pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = url.pathname.match(new RegExp(`^${escaped}([^/]+)/?$`));
    if (!match) return null;
    let slug;
    try { slug = decodeURIComponent(match[1]); } catch { return null; }
    return rowForIdentity(slug);
  }

  function setSelected(row) {
    rows().forEach((candidate) => {
      const selected = candidate === row;
      candidate.classList.toggle('is-selected', selected);
      if (selected) candidate.setAttribute('aria-current', 'true');
      else candidate.removeAttribute('aria-current');
    });
  }

  function initWidgets(scope) {
    for (const widget of config.widgetInitializers || []) {
      if (typeof window[widget] === 'function') window[widget](scope);
    }
  }

  function showStatus(status, message) {
    status.textContent = message;
    status.hidden = false;
  }

  function hideStatus(status) { status.hidden = true; }

  function updateHash(row, replace, sheetEntry) {
    const encoded = config.hashForRow ? config.hashForRow(row) : encodeURIComponent(slugOf(row));
    const next = `#${encoded}`;
    lastHandledHash = next;
    if (window.location.hash === next) return;
    const keepSheetEntry = replace && history.state && history.state.itemIndexSheet;
    const state = sheetEntry || keepSheetEntry ? { itemIndexSheet: true } : null;
    if (replace) history.replaceState(state, '', next);
    else history.pushState(state, '', next);
  }

  function render(content, scrollOwner, html) {
    content.innerHTML = html;
    scrollOwner.scrollTop = 0;
    initWidgets(content);
    if (!reducedMotion.matches) {
      content.classList.remove('is-arriving');
      void content.offsetWidth;
      content.classList.add('is-arriving');
    }
  }

  const sheetIsOpen = () => sheet.classList.contains('is-open');

  function openSheet(row) {
    const wasOpen = sheetIsOpen();
    sheetTitle.textContent = nameOf(row);
    sheet.classList.add('is-open');
    scrim.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('item-index-sheet-open');
    document.body.classList.add('item-index-sheet-open');
    document.documentElement.classList.add('gem-index-sheet-open');
    document.body.classList.add('gem-index-sheet-open');
    if (!wasOpen) {
      lastSheetTrigger = row;
      sheetClose.focus({ preventScroll: true });
    }
  }

  function closeSheet(restoreFocus) {
    if (!sheetIsOpen()) return;
    requestId++;
    sheet.classList.remove('is-open');
    scrim.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.removeAttribute('aria-busy');
    document.documentElement.classList.remove('item-index-sheet-open');
    document.body.classList.remove('item-index-sheet-open');
    document.documentElement.classList.remove('gem-index-sheet-open');
    document.body.classList.remove('gem-index-sheet-open');
    hideStatus(sheetStatus);
    if (restoreFocus !== false && lastSheetTrigger) lastSheetTrigger.focus({ preventScroll: true });
  }

  function dismissSheet() {
    if (!sheetIsOpen()) return;
    if (history.state && history.state.itemIndexSheet) {
      history.back();
      return;
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    lastHandledHash = '';
    closeSheet();
  }

  function resetVisibility() {
    root.querySelectorAll('.item-index-filters .filter-btn.is-active').forEach((button) => button.classList.remove('is-active'));
    root.querySelectorAll('.item-index-filters .filter-select').forEach((select) => {
      select.value = '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const input = root.querySelector('[data-item-index-search]');
    if (input) input.value = '';
    rows().forEach((row) => { row.style.display = ''; });
    const rowsContainer = root.querySelector('.item-index-rows');
    const empty = root.querySelector('[data-item-index-empty]');
    const count = root.querySelector('[data-filter-count]');
    if (rowsContainer) rowsContainer.hidden = false;
    if (empty) empty.hidden = true;
    if (count) count.textContent = rows().length;
    root.dispatchEvent(new CustomEvent(searchEvent));
  }

  function revealRow(row) {
    if (row.style.display === 'none') resetVisibility();
    row.scrollIntoView({
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest',
    });
    if (reducedMotion.matches) return;
    window.clearTimeout(arrivalTimer);
    if (arrivingRow && arrivingRow !== row) arrivingRow.classList.remove('is-arriving');
    arrivingRow = row;
    row.classList.remove('is-arriving');
    void row.offsetWidth;
    row.classList.add('is-arriving');
    arrivalTimer = window.setTimeout(() => {
      row.classList.remove('is-arriving');
      if (arrivingRow === row) arrivingRow = null;
    }, 1000);
  }

  function detailRequest(row) {
    if (config.detailResolver) return config.detailResolver(row);
    return { url: row.getAttribute('href'), selector: detailSelector };
  }

  function extractDetail(html, request, row) {
    if (!request.selector) {
      return `<div class="gem-detail item-detail tc-fragment-detail" data-item-slug="${slugOf(row)}">` +
        '<p class="tc-fragment-detail__note">This kind has no standalone page; showing its prebuilt detail fragment.</p>' +
        html + '</div>';
    }
    const page = new DOMParser().parseFromString(html, 'text/html');
    const detail = page.querySelector(request.selector);
    if (!detail) throw new Error(`Missing ${request.selector}`);
    return detail.outerHTML;
  }

  function loadDetails(row, target) {
    const request = detailRequest(row);
    const url = request?.url;
    if (!url) return;
    const targetPane = target === 'pane';
    const targetElement = targetPane ? pane : sheet;
    const targetContent = targetPane ? paneContent : sheetContent;
    const targetStatus = targetPane ? paneStatus : sheetStatus;
    const currentRequest = ++requestId;
    if (cache.has(url)) {
      render(targetContent, targetElement, cache.get(url));
      targetElement.setAttribute('aria-busy', 'false');
      hideStatus(targetStatus);
      return;
    }
    targetElement.setAttribute('aria-busy', 'true');
    showStatus(targetStatus, `Loading ${nameOf(row)}…`);
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => extractDetail(html, request, row))
      .then((html) => {
        cache.set(url, html);
        if (currentRequest !== requestId) return;
        render(targetContent, targetElement, html);
        targetElement.setAttribute('aria-busy', 'false');
        hideStatus(targetStatus);
      })
      .catch(() => {
        if (currentRequest !== requestId) return;
        targetElement.setAttribute('aria-busy', 'false');
        showStatus(targetStatus, `Details could not be loaded. Open the ${noun} page to try again.`);
      });
  }

  function select(row, options = {}) {
    if (!row) return;
    setSelected(row);
    if (options.updateHash !== false) updateHash(row, !!options.replaceHash, !desktop.matches && !options.replaceHash);
    if (options.reveal) revealRow(row);
    if (desktop.matches) loadDetails(row, 'pane');
    else {
      openSheet(row);
      loadDetails(row, 'sheet');
    }
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('.card-actions, .item-action-bar')) return;
    const detailLink = event.target.closest('.item-index-pane__content a[href], .item-index-sheet__content a[href]');
    if (detailLink) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const linkedRow = rowForDetailLink(detailLink);
      if (!linkedRow) return;
      event.preventDefault();
      select(linkedRow, { reveal: true, replaceHash: !desktop.matches });
      return;
    }
    const row = event.target.closest(rowSelector);
    if (!row || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(row, { replaceHash: !desktop.matches && sheetIsOpen() });
  });

  root.querySelectorAll('[data-item-sheet-dismiss]').forEach((button) => button.addEventListener('click', dismissSheet));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !sheetIsOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    dismissSheet();
  }, true);

  function selectFromLocation() {
    if (window.location.hash === lastHandledHash) return;
    lastHandledHash = window.location.hash;
    const row = rowForHash();
    if (row) select(row, { updateHash: false, reveal: true });
    else if (!desktop.matches) closeSheet();
    else if (!window.location.hash && initialRow) select(initialRow, { updateHash: false, reveal: true });
  }

  window.addEventListener('hashchange', selectFromLocation);
  window.addEventListener('popstate', selectFromLocation);
  root.addEventListener('item-index:rows-changed', () => {
    lastHandledHash = null;
    selectFromLocation();
  });
  // Filter changes never steal the selection: if the selected row gets hidden,
  // the pane keeps showing it (same rule as local search). Auto-selecting the
  // "first visible" here raced the search intersection and picked a row even
  // when the final result set was empty.
  desktop.addEventListener('change', () => {
    const selected = rowForHash() || root.querySelector(`${rowSelector}.is-selected`);
    if (desktop.matches) closeSheet(false);
    if (selected && window.location.hash) select(selected, { updateHash: false });
  });

  // Local full-text search intersects the generic filter bar's result.
  const input = root.querySelector('[data-item-index-search]');
  if (input) {
    const rowsContainer = root.querySelector('.item-index-rows');
    const count = root.querySelector('[data-filter-count]');
    const empty = root.querySelector('[data-item-index-empty]');
    const clearButton = root.querySelector('[data-item-search-clear]');
    const filterVisible = new Map();
    let docs = null;
    let loading = null;
    let timer = null;
    let queryVersion = 0;
    let activeMatchedSlugs = new Set();
    let activeHasQuery = false;
    const rowSlugForDoc = new Map();
    rows().forEach((row) => {
      rowSlugForDoc.set(slugOf(row), slugOf(row));
      if (!resultSlugKey) return;
      for (const docSlug of (row.dataset[resultSlugKey] || '').split(' ').filter(Boolean)) {
        rowSlugForDoc.set(docSlug, slugOf(row));
      }
    });

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
            docs = raw.filter((doc) => categories.has(doc.category));
            if (rowTextKey) {
              docs.push(...rows().map((row) => ({
                slug: slugOf(row),
                category: [...categories][0] || 'item',
                text: (row.dataset[rowTextKey] || nameOf(row)).toLowerCase(),
                tags: [], req: [], grants: [],
              })));
            }
            return docs;
          })
          .finally(() => input.removeAttribute('aria-busy'));
      }
      return loading;
    }

    const captureFilterVisibility = () => rows().forEach((row) => filterVisible.set(row, row.style.display !== 'none'));
    function renderMatches(matchedSlugs, hasQuery) {
      let shown = 0;
      rows().forEach((row) => {
        const visible = filterVisible.get(row) !== false && (!hasQuery || matchedSlugs.has(slugOf(row)));
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
    function applyQuery(query, indexDocs) {
      const terms = parseQuery(query).terms;
      const matchedSlugs = new Set(terms.length
        ? indexDocs.filter((doc) => docMatches(doc, terms)).map((doc) => rowSlugForDoc.get(doc.slug)).filter(Boolean)
        : []);
      commitMatches(matchedSlugs, terms.length > 0);
      if (terms.length && config.selectFirstSearchMatch && desktop.matches) {
        const selected = root.querySelector(`${rowSelector}.is-selected`);
        if (!selected || selected.style.display === 'none') {
          const firstMatch = rows().find((row) => row.style.display !== 'none');
          if (firstMatch) select(firstMatch, { replaceHash: true });
        }
      }
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
      if (!query) return commitMatches(new Set(), false);
      loadIndex().then((indexDocs) => {
        if (version === queryVersion && input.value.trim() === query) applyQuery(query, indexDocs);
      }).catch(() => {
        if (version === queryVersion) commitMatches(new Set(), false);
      });
    }
    captureFilterVisibility();
    root.addEventListener('filter-bar:applied', () => {
      captureFilterVisibility();
      renderMatches(activeMatchedSlugs, activeHasQuery);
    });
    root.addEventListener(searchEvent, () => {
      clearTimeout(timer);
      queryVersion++;
      input.value = '';
      activeMatchedSlugs = new Set();
      activeHasQuery = false;
      captureFilterVisibility();
      renderMatches(activeMatchedSlugs, activeHasQuery);
    });
    input.addEventListener('focus', () => { loadIndex().catch(() => {}); }, { once: true });
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(runSearch, 200);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSearch();
      }
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

  const initialRow = root.querySelector(`${rowSelector}.is-selected`);
  const initialDetail = paneContent.querySelector(detailSelector);
  if (initialRow && initialDetail) cache.set(initialRow.getAttribute('href'), initialDetail.outerHTML);
  const restored = rowForHash();
  if (restored) {
    lastHandledHash = window.location.hash;
    select(restored, { updateHash: false, reveal: true });
  } else initWidgets(paneContent);
}
