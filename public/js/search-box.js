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

  function highlight(i) {
    var rs = rows();
    if (sel >= 0 && rs[sel]) rs[sel].classList.remove('active');
    sel = i;
    if (sel >= 0 && rs[sel]) {
      rs[sel].classList.add('active');
      rs[sel].scrollIntoView({ block: 'nearest' });
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
  new MutationObserver(function () { sel = -1; })
    .observe(results, { childList: true });

  // Clicking anywhere outside the search box dismisses the dropdown.
  document.addEventListener('click', function (e) {
    if (!box.contains(e.target)) { hide(); sel = -1; }
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

  // "/" focuses the search box from anywhere (unless already typing).
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
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
