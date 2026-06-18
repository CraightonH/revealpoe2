// Modular filter bar. Finds every .filter-bar on the page and wires up
// toggle-button filtering against data attributes on target elements.
//
// HTML contract:
//   .filter-bar[data-target][data-section?]
//     .filter-group[data-key][data-match?][data-single?]  (match: "all" (default) | "any")
//       .filter-btn[data-value]  (toggleable)
//
// data-single: only one button in the group may be active at a time (radio-like);
//   clicking the active button clears it.
//
// Filter logic (per .filter-bar):
//   - For each .filter-group, collect its active (selected) values.
//   - A target element passes a group if the group has no active values, OR:
//       match="all" (AND, default): every active value appears in the element's
//         data-{key} (space-separated). Use for multi-valued attributes where you
//         want to narrow (e.g. Requires Str AND Dex).
//       match="any" (OR): at least one active value appears. Use for
//         single-valued attributes where selections widen (e.g. Type, Origin).
//   - AND across groups: an element must pass all groups to remain visible.
//   - If data-section is set, any section container with no visible children
//     is hidden automatically.
(function () {
  document.querySelectorAll('.filter-bar').forEach(function (bar) {
    var targetSel  = bar.dataset.target;
    var sectionSel = bar.dataset.section || null;
    var groups     = Array.from(bar.querySelectorAll('.filter-group'));

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;
      var group = btn.closest('.filter-group');
      if (group && group.dataset.single !== undefined) {
        // Radio-like: clear the group, then re-select unless we just cleared
        // the button that was already active.
        var wasActive = btn.classList.contains('is-active');
        group.querySelectorAll('.filter-btn.is-active')
             .forEach(function (b) { b.classList.remove('is-active'); });
        if (!wasActive) btn.classList.add('is-active');
      } else {
        btn.classList.toggle('is-active');
      }
      applyFilters();
    });

    // Apply any default (server-rendered is-active) selections on load.
    applyFilters();

    function applyFilters() {
      var activeFilters = groups.map(function (g) {
        return {
          key: g.dataset.key,
          match: g.dataset.match === 'any' ? 'any' : 'all',
          values: Array.from(g.querySelectorAll('.filter-btn.is-active'))
                       .map(function (b) { return b.dataset.value; }),
        };
      });

      document.querySelectorAll(targetSel).forEach(function (item) {
        var visible = activeFilters.every(function (f) {
          if (!f.values.length) return true;
          var itemVals = (item.dataset[f.key] || '').split(' ').filter(Boolean);
          var has = function (v) { return itemVals.indexOf(v) !== -1; };
          return f.match === 'any' ? f.values.some(has) : f.values.every(has);
        });
        item.style.display = visible ? '' : 'none';
      });

      if (sectionSel) {
        document.querySelectorAll(sectionSel).forEach(function (section) {
          var hasVisible = Array.from(section.querySelectorAll(targetSel))
            .some(function (el) { return el.style.display !== 'none'; });
          section.style.display = hasVisible ? '' : 'none';
        });
      }
    }
  });
})();
