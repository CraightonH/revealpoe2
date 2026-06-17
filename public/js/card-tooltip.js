// Generic card tooltip. Fetches HTML from data-card-url on hover and shows
// it in a Tippy popup. Works for any element with that attribute set.
(function () {
  if (!window.poe2Tooltips) return;

  window.poe2Tooltips.init({
    target: '[data-card-url]',
    resolveUrl: function (reference) {
      return reference.dataset.cardUrl || null;
    },
  });
})();
