// Modular filter bar. Finds every .filter-bar on the page and wires up
// toggle-button filtering against data attributes on target elements.
//
// HTML contract:
//   .filter-bar[data-target][data-section?]
//     .filter-group[data-key]
//       .filter-btn[data-value]  (toggleable)
//
// Filter logic (per .filter-bar):
//   - For each .filter-group, collect its active (selected) values.
//   - A target element passes a group if: the group has no active values, OR
//     every active value appears in the element's data-{key} (space-separated).
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
      btn.classList.toggle('is-active');
      applyFilters();
    });

    function applyFilters() {
      var activeFilters = groups.map(function (g) {
        return {
          key: g.dataset.key,
          values: Array.from(g.querySelectorAll('.filter-btn.is-active'))
                       .map(function (b) { return b.dataset.value; }),
        };
      });

      document.querySelectorAll(targetSel).forEach(function (item) {
        var visible = activeFilters.every(function (f) {
          if (!f.values.length) return true;
          var itemVals = (item.dataset[f.key] || '').split(' ').filter(Boolean);
          return f.values.every(function (v) { return itemVals.indexOf(v) !== -1; });
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
