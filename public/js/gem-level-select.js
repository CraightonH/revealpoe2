// Gem level selector. The gem card renders every level's cost / requirements / effect
// sections as sibling `.gem-lv[data-level]` variants (only the default is visible); this
// script shows the one matching the <select> and highlights the same level in the
// per-level scaling table below. Pure visibility toggling over server-rendered HTML — no
// data resolution here, so the static build behaves identically to the dev server.
(function () {
  document.querySelectorAll('.gem-level-select').forEach(function (sel) {
    // Scope variant toggling to this gem's card so multiple cards on a page stay independent;
    // the scaling table is a sibling of the card, so fall back to the detail container for it.
    var card = sel.closest('.newItemPopup') || document;
    var detail = sel.closest('.gem-detail') || document;

    function apply(level) {
      card.querySelectorAll('.gem-lv[data-level]').forEach(function (el) {
        el.hidden = el.dataset.level !== String(level);
      });
      detail.querySelectorAll('.gem-levels-row[data-level]').forEach(function (row) {
        row.classList.toggle('gem-levels-row--sel', row.dataset.level === String(level));
      });
    }

    sel.addEventListener('change', function () { apply(sel.value); });
    apply(sel.value); // sync the table highlight to the initial selection
  });
})();
