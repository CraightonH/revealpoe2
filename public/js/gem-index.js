// Progressive master-detail behavior for /gems. Wide screens fetch complete
// gem-detail fragments into the persistent pane; narrow screens retain ordinary
// link navigation. Fragment HTML is cached for the life of the page.
(function () {
  var root = document.querySelector('.gem-index');
  if (!root) return;

  var desktop = window.matchMedia('(min-width: 900px)');
  var pane = root.querySelector('.gem-index-pane');
  var content = root.querySelector('.gem-index-pane__content');
  var status = root.querySelector('.gem-index-pane__status');
  var cache = new Map();
  var requestId = 0;
  var arrivalTimer = 0;
  var arrivingRow = null;
  var lastHandledHash = null;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function rows() {
    return Array.from(root.querySelectorAll('.gem-index-row[data-pane-url]'));
  }

  function rowForHash() {
    var slug;
    try { slug = decodeURIComponent(window.location.hash.slice(1)); } catch (e) { return null; }
    if (!slug) return null;
    return rows().find(function (row) { return row.dataset.gemSlug === slug; }) || null;
  }

  function rowForGemLink(anchor) {
    var url;
    try { url = new URL(anchor.href, window.location.href); } catch (e) { return null; }
    if (url.origin !== window.location.origin) return null;
    var match = url.pathname.match(/^\/gem\/([^/]+)\/?$/);
    if (!match) return null;
    var slug;
    try { slug = decodeURIComponent(match[1]); } catch (e) { return null; }
    return rows().find(function (row) { return row.dataset.gemSlug === slug; }) || null;
  }

  function setSelected(row) {
    rows().forEach(function (candidate) {
      var selected = candidate === row;
      candidate.classList.toggle('is-selected', selected);
      if (selected) candidate.setAttribute('aria-current', 'true');
      else candidate.removeAttribute('aria-current');
    });
  }

  function initWidgets(scope) {
    if (typeof window.initGemLevelSelect === 'function') window.initGemLevelSelect(scope);
    if (typeof window.initGemQualityInput === 'function') window.initGemQualityInput(scope);
    if (typeof window.initScalingToggle === 'function') window.initScalingToggle(scope);
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function hideStatus() {
    status.hidden = true;
  }

  function updateHash(row, replace) {
    var next = '#' + encodeURIComponent(row.dataset.gemSlug);
    lastHandledHash = next;
    if (window.location.hash === next) return;
    if (replace) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
  }

  function render(html) {
    content.innerHTML = html;
    pane.scrollTop = 0;
    initWidgets(content);
    if (!reducedMotion.matches) {
      content.classList.remove('is-arriving');
      void content.offsetWidth;
      content.classList.add('is-arriving');
    }
  }

  function resetVisibility() {
    root.querySelectorAll('.gem-index-filters .filter-btn.is-active').forEach(function (button) {
      button.classList.remove('is-active');
    });

    var input = root.querySelector('[data-gem-index-search]');
    if (input) input.value = '';
    rows().forEach(function (row) { row.style.display = ''; });

    var rowsContainer = root.querySelector('.gem-index-rows');
    var empty = root.querySelector('[data-gem-index-empty]');
    var count = root.querySelector('[data-filter-count]');
    if (rowsContainer) rowsContainer.hidden = false;
    if (empty) empty.hidden = true;
    if (count) count.textContent = rows().length;

    root.dispatchEvent(new CustomEvent('gem-index:visibility-reset'));
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
    arrivalTimer = window.setTimeout(function () {
      row.classList.remove('is-arriving');
      if (arrivingRow === row) arrivingRow = null;
    }, 1000);
  }

  function select(row, options) {
    if (!row) return;
    options = options || {};
    setSelected(row);
    if (options.updateHash !== false) updateHash(row, !!options.replaceHash);
    if (options.reveal) revealRow(row);
    if (!desktop.matches) return;

    var url = row.dataset.paneUrl;
    var currentRequest = ++requestId;

    if (cache.has(url)) {
      render(cache.get(url));
      pane.setAttribute('aria-busy', 'false');
      hideStatus();
      return;
    }

    pane.setAttribute('aria-busy', 'true');
    showStatus('Loading ' + row.dataset.gemName + '…');
    fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(function (html) {
        cache.set(url, html);
        if (currentRequest !== requestId) return;
        render(html);
        pane.setAttribute('aria-busy', 'false');
        hideStatus();
      })
      .catch(function () {
        if (currentRequest !== requestId) return;
        pane.setAttribute('aria-busy', 'false');
        showStatus('Details could not be loaded. Open the gem page to try again.');
      });
  }

  root.addEventListener('click', function (event) {
    var paneLink = event.target.closest('.gem-index-pane__content a[href]');
    if (paneLink && content.contains(paneLink) && desktop.matches) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var linkedRow = rowForGemLink(paneLink);
      if (!linkedRow) return;
      event.preventDefault();
      select(linkedRow, { reveal: true });
      return;
    }

    var row = event.target.closest('.gem-index-row[data-pane-url]');
    if (!row || !desktop.matches) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(row);
  });

  function selectFromLocation() {
    if (window.location.hash === lastHandledHash) return;
    lastHandledHash = window.location.hash;
    var row = rowForHash();
    if (row) select(row, { updateHash: false, reveal: true });
    else if (!window.location.hash && initialRow) select(initialRow, { updateHash: false, reveal: true });
  }

  window.addEventListener('hashchange', selectFromLocation);
  window.addEventListener('popstate', selectFromLocation);

  root.addEventListener('filter-bar:applied', function () {
    if (!desktop.matches) return;
    var selected = root.querySelector('.gem-index-row.is-selected');
    if (selected && selected.style.display !== 'none') return;
    var firstVisible = rows().find(function (row) { return row.style.display !== 'none'; });
    if (firstVisible) select(firstVisible, { replaceHash: true });
  });

  var initialRow = root.querySelector('.gem-index-row.is-selected');
  if (initialRow) cache.set(initialRow.dataset.paneUrl, content.innerHTML);
  var restored = rowForHash();
  if (restored) {
    lastHandledHash = window.location.hash;
    select(restored, { updateHash: false, reveal: true });
  }
  else initWidgets(content);
})();
