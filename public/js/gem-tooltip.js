// Lazy gem card tooltips on .gem-browse-card links.
// Fetches /gem/:slug/card once per slug, caches in memory.
(function () {
  if (!window.poe2Tooltips) return;

  function slugFromHref(href) {
    var m = href && href.match(/\/gem\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  window.poe2Tooltips.init({
    target: '.gem-browse-card',
    resolveUrl: function (reference) {
      var slug = slugFromHref(reference.getAttribute('href'));
      return slug ? '/gem/' + encodeURIComponent(slug) + '/card' : null;
    },
  });
})();
