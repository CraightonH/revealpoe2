// Search dropdown visibility + keyboard interaction. htmx fills #search-results
// on input (server render); the static build renders from the prebuilt index
// instead. Everything below works off the DOM rows, so it is renderer-agnostic.
(function () {
  var box = document.querySelector('.search-box');
  if (!box) return;
  var results = box.querySelector('#search-results');
  var input = box.querySelector('input[type="search"]');
  if (!results || !input) return;

  function hide() { results.style.display = 'none'; }
  function show() { results.style.display = ''; }

  // --- Keyboard navigation over the rendered result rows ---
  var sel = -1; // index into rows(), -1 = nothing highlighted
  function rows() { return results.querySelectorAll('.search-result-row'); }

  // Keyboard "hover": run the row's tooltip through the same delegated tippy
  // handlers a real mouse hover would hit, so arrow-key navigation shows the
  // card/keyword tip for affix and glossary rows.
  function tipTarget(row) {
    if (!row) return null;
    var kw = row.querySelector('.kw');
    if (kw) return kw;
    return row.hasAttribute('data-card-url') ? row : null;
  }
  function showTip(row) {
    var t = tipTarget(row);
    if (!t || typeof window.tippy !== 'function') return;
    // The delegate stamps _tippy on first hover; reuse it when present, else
    // fire the delegated listener with a synthetic mouseover (the delegate
    // creates the instance with showOnCreate, so the tip appears on its own).
    if (t._tippy) t._tippy.show();
    else t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }
  function hideTips() {
    if (window.tippy && typeof window.tippy.hideAll === 'function') {
      window.tippy.hideAll({ duration: 0 });
    }
  }

  function highlight(i) {
    var rs = rows();
    if (sel >= 0 && rs[sel]) rs[sel].classList.remove('active');
    hideTips();
    sel = i;
    if (sel >= 0 && rs[sel]) {
      rs[sel].classList.add('active');
      rs[sel].scrollIntoView({ block: 'nearest' });
      showTip(rs[sel]);
    }
  }

  function move(dir) {
    var rs = rows();
    if (!rs.length) return;
    if (results.style.display === 'none') { show(); highlight(dir > 0 ? 0 : rs.length - 1); return; }
    var next = sel < 0 ? (dir > 0 ? 0 : rs.length - 1) : sel + dir;
    highlight(Math.max(0, Math.min(rs.length - 1, next)));
  }

  function activate(row) {
    if (!row) return;
    // Rows with a page link navigate; tooltip-only rows (affix flyout,
    // glossary keyword) get focus so their tip/tooltip handlers kick in.
    if (row.getAttribute('href')) window.location.href = row.getAttribute('href');
    else row.focus();
  }

  // Re-render (htmx swap or static innerHTML) invalidates the highlight.
  new MutationObserver(function () { sel = -1; hideTips(); })
    .observe(results, { childList: true });

  // Clicking anywhere outside the search box dismisses the dropdown.
  document.addEventListener('click', function (e) {
    if (!box.contains(e.target)) { hide(); sel = -1; hideTips(); }
  });

  input.addEventListener('keydown', function (e) {
    // Arrow keys move the highlight through the rendered rows.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    // Esc dismisses while keeping focus in the field.
    if (e.key === 'Escape') { hide(); highlight(-1); return; }
    if (e.key === 'Enter') {
      var active = sel >= 0 && rows()[sel];
      if (active) { e.preventDefault(); activate(active); return; }
      // No row highlighted: take the full query to Theory Crafting,
      // prepopulated and run.
      var q = input.value.trim();
      if (!q) return;
      e.preventDefault();
      window.location.href = '/theorycraft?q=' + encodeURIComponent(q);
    }
  });

  // "?" (shift+/) focuses the global search box from anywhere (unless
  // already typing). "/" is left to the page-local index filters.
  document.addEventListener('keydown', function (e) {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
              t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    input.focus();
  });

  // Refocusing or typing brings the (already-fetched) results back.
  input.addEventListener('focus', show);
  input.addEventListener('input', show);
})();
