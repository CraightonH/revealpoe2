// Lazy gem card tooltips on .gem-browse-card and .support-list a links.
// Fetches /gem/:slug/card once per slug, caches in memory.
(function () {
  if (typeof window.tippy !== 'function') return;

  var cache = new Map();

  function slugFromHref(href) {
    var m = href && href.match(/\/gem\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  window.tippy.delegate('body', {
    target: '.gem-browse-card, .support-list a',
    interactive: true,
    allowHTML: true,
    delay: [150, 80],
    maxWidth: 'none',
    theme: 'poe2',
    placement: 'right-start',
    appendTo: function () { return document.body; },
    popperOptions: {
      modifiers: [
        { name: 'preventOverflow', options: { padding: 8, altAxis: true, tether: false } },
        { name: 'flip', options: { padding: 8, fallbackPlacements: ['left-start', 'right', 'left'] } },
      ],
    },
    onShown: function (instance) {
      if (instance.popperInstance) instance.popperInstance.update();
    },
    content: '',
    onShow: function (instance) {
      var slug = slugFromHref(instance.reference.getAttribute('href'));
      if (!slug) return false;
      if (cache.has(slug)) {
        instance.setContent(cache.get(slug));
        return;
      }
      if (instance._gemLoading) return;
      instance._gemLoading = true;
      fetch('/gem/' + encodeURIComponent(slug) + '/card')
        .then(function (r) {
          return r.ok ? r.text() : null;
        })
        .then(function (html) {
          if (html) {
            cache.set(slug, html);
            instance.setContent(html);
          }
        })
        .catch(function () {})
        .finally(function () { instance._gemLoading = false; });
    },
  });
})();
