// Progressive master-detail behavior for /gems. Gem details come from the
// canonical dedicated page and are cached after extracting its .gem-detail.
(function () {
  var root = document.querySelector('.gem-index');
  if (!root) return;

  var desktop = window.matchMedia('(min-width: 900px)');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var pane = root.querySelector('.gem-index-pane');
  var paneContent = root.querySelector('.gem-index-pane__content');
  var paneStatus = root.querySelector('.gem-index-pane__status');
  var sheet = root.querySelector('.gem-index-sheet');
  var sheetContent = root.querySelector('.gem-index-sheet__content');
  var sheetStatus = root.querySelector('.gem-index-sheet__status');
  var sheetTitle = root.querySelector('.gem-index-sheet__title');
  var sheetClose = root.querySelector('.gem-index-sheet__close');
  var cache = new Map();
  var requestId = 0;
  var arrivalTimer = 0;
  var arrivingRow = null;
  var lastHandledHash = null;
  var lastSheetTrigger = null;

  function rows() {
    return Array.from(root.querySelectorAll('.gem-index-row[data-gem-slug]'));
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

  function showStatus(status, message) {
    status.textContent = message;
    status.hidden = false;
  }

  function hideStatus(status) {
    status.hidden = true;
  }

  function updateHash(row, replace, sheetEntry) {
    var next = '#' + encodeURIComponent(row.dataset.gemSlug);
    lastHandledHash = next;
    if (window.location.hash === next) return;
    var keepSheetEntry = replace && history.state && history.state.gemIndexSheet;
    var state = sheetEntry || keepSheetEntry ? { gemIndexSheet: true } : null;
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

  function sheetIsOpen() {
    return sheet.classList.contains('is-open');
  }

  function openSheet(row) {
    var wasOpen = sheetIsOpen();
    sheetTitle.textContent = row.dataset.gemName;
    sheet.classList.add('is-open');
    root.querySelector('.gem-index-sheet-scrim').classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
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
    root.querySelector('.gem-index-sheet-scrim').classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.removeAttribute('aria-busy');
    document.documentElement.classList.remove('gem-index-sheet-open');
    document.body.classList.remove('gem-index-sheet-open');
    hideStatus(sheetStatus);
    if (restoreFocus !== false && lastSheetTrigger) lastSheetTrigger.focus({ preventScroll: true });
  }

  function dismissSheet() {
    if (!sheetIsOpen()) return;
    // A sheet opened by a row owns exactly one marked history entry. Links
    // inside it replace that entry, so Back closes the whole sheet in one step.
    if (history.state && history.state.gemIndexSheet) {
      history.back();
      return;
    }
    // A directly loaded #slug has no index-owned entry to go back to. Remove
    // only its hash in place so dismissing cannot unexpectedly leave /gems.
    history.replaceState(null, '', window.location.pathname + window.location.search);
    lastHandledHash = '';
    closeSheet();
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

  function extractDetail(html) {
    var documentPage = new DOMParser().parseFromString(html, 'text/html');
    var detail = documentPage.querySelector('.gem-detail');
    if (!detail) throw new Error('Missing .gem-detail');
    return detail.outerHTML;
  }

  function loadDetails(row, target) {
    var url = row.getAttribute('href');
    var targetPane = target === 'pane';
    var targetElement = targetPane ? pane : sheet;
    var targetContent = targetPane ? paneContent : sheetContent;
    var targetStatus = targetPane ? paneStatus : sheetStatus;
    var currentRequest = ++requestId;

    if (cache.has(url)) {
      render(targetContent, targetElement, cache.get(url));
      targetElement.setAttribute('aria-busy', 'false');
      hideStatus(targetStatus);
      return;
    }

    targetElement.setAttribute('aria-busy', 'true');
    showStatus(targetStatus, 'Loading ' + row.dataset.gemName + '…');
    fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(extractDetail)
      .then(function (html) {
        cache.set(url, html);
        if (currentRequest !== requestId) return;
        render(targetContent, targetElement, html);
        targetElement.setAttribute('aria-busy', 'false');
        hideStatus(targetStatus);
      })
      .catch(function () {
        if (currentRequest !== requestId) return;
        targetElement.setAttribute('aria-busy', 'false');
        showStatus(targetStatus, 'Details could not be loaded. Open the gem page to try again.');
      });
  }

  function select(row, options) {
    if (!row) return;
    options = options || {};
    setSelected(row);
    if (options.updateHash !== false) {
      updateHash(row, !!options.replaceHash, !desktop.matches && !options.replaceHash);
    }
    if (options.reveal) revealRow(row);

    if (desktop.matches) {
      loadDetails(row, 'pane');
      return;
    }

    openSheet(row);
    loadDetails(row, 'sheet');
  }

  root.addEventListener('click', function (event) {
    var detailLink = event.target.closest('.gem-index-pane__content a[href], .gem-index-sheet__content a[href]');
    if (detailLink) {
      var detailContent = detailLink.closest('.gem-index-pane__content, .gem-index-sheet__content');
      if (!detailContent || !root.contains(detailContent)) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var linkedRow = rowForGemLink(detailLink);
      if (!linkedRow) return;
      event.preventDefault();
      select(linkedRow, { reveal: true, replaceHash: !desktop.matches });
      return;
    }

    var row = event.target.closest('.gem-index-row[data-gem-slug]');
    if (!row) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(row, { replaceHash: !desktop.matches && sheetIsOpen() });
  });

  root.querySelectorAll('[data-gem-sheet-dismiss]').forEach(function (dismiss) {
    dismiss.addEventListener('click', dismissSheet);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !sheetIsOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    dismissSheet();
  }, true);

  function selectFromLocation() {
    if (window.location.hash === lastHandledHash) return;
    lastHandledHash = window.location.hash;
    var row = rowForHash();
    if (row) {
      select(row, { updateHash: false, reveal: true });
    } else if (!desktop.matches) {
      closeSheet();
    } else if (!window.location.hash && initialRow) {
      select(initialRow, { updateHash: false, reveal: true });
    }
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

  desktop.addEventListener('change', function () {
    var selected = rowForHash() || root.querySelector('.gem-index-row.is-selected');
    if (desktop.matches) closeSheet(false);
    if (selected && window.location.hash) select(selected, { updateHash: false });
  });

  var initialRow = root.querySelector('.gem-index-row.is-selected');
  var initialDetail = paneContent.querySelector('.gem-detail');
  if (initialRow && initialDetail) cache.set(initialRow.getAttribute('href'), initialDetail.outerHTML);
  var restored = rowForHash();
  if (restored) {
    lastHandledHash = window.location.hash;
    select(restored, { updateHash: false, reveal: true });
  } else {
    initWidgets(paneContent);
  }
})();
