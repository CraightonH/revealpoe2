// Lazy keyword tooltips. One delegated Tippy instance handles every `.kw`
// (including spans injected inside open tooltips). Each keyword's fragment is
// fetched once from /api/keyword/:key and cached in memory.
(function () {
  if (!window.poe2Tooltips) return;

  window.poe2Tooltips.init({
    target: '.kw',
    resolveUrl: function (reference) {
      var key = reference.getAttribute('data-keyword');
      return key ? '/api/keyword/' + encodeURIComponent(key) : null;
    },
    fallback: 'No description available.',
    // Keyword tooltips are narrower than gem/item cards and show a loading
    // placeholder while fetching.
    overrides: {
      maxWidth: 360,
      content: 'Loading…',
    },
  });
})();
