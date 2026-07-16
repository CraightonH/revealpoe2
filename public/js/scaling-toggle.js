// Gem "Scaling" table interactions (see views/macros/gem-level-table.njk):
//   1. Levels ⇄ Quality mode toggle — swaps the two server-rendered panels and
//      updates the count badge. Only present when a gem has both tables.
//   2. Quality-table band expansion — a smooth gem's coarse row with a caret reveals
//      its hidden off-grid breakpoint rows (same behaviour as the affix accordion).
// Pure visibility toggling over server-rendered HTML — no data resolution — so the
// static build behaves identically to the dev server.
(function () {
  // ── Mode toggle ────────────────────────────────────────────────────────────
  document.querySelectorAll('.scaling-modes').forEach(function (modes) {
    var group = modes.closest('.gem-levels') || document;
    var badge = group.querySelector('[data-scaling-count]');
    modes.querySelectorAll('.scaling-mode').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.dataset.scalingMode;
        modes.querySelectorAll('.scaling-mode').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        group.querySelectorAll('[data-scaling-panel]').forEach(function (panel) {
          panel.hidden = panel.dataset.scalingPanel !== mode;
        });
        if (badge && btn.dataset.scalingLabel) badge.textContent = btn.dataset.scalingLabel;
      });
    });
  });

  // ── Quality band expansion ───────────────────────────────────────────────────
  function bandRows(row) {
    var rows = [];
    var el = row.nextElementSibling;
    while (el && el.classList.contains('gem-qual-band-row')) {
      rows.push(el);
      el = el.nextElementSibling;
    }
    return rows;
  }

  function toggleBand(row) {
    if (row.getAttribute('aria-expanded') === null) return; // not an expandable row
    var open = row.getAttribute('aria-expanded') === 'true';
    row.setAttribute('aria-expanded', open ? 'false' : 'true');
    bandRows(row).forEach(function (r) { r.hidden = open; });
  }

  document.addEventListener('click', function (e) {
    var row = e.target.closest('.gem-qual-row');
    if (row) toggleBand(row);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target.closest('.gem-qual-row');
    if (!row || row.getAttribute('aria-expanded') === null) return;
    e.preventDefault();
    toggleBand(row);
  });
})();
