// Generic card tooltip. Fetches HTML from data-card-url on hover and shows
// it in a Tippy popup. Works for any element with that attribute set.
(function () {
  if (typeof window.tippy !== 'function') return;

  var cache = new Map();

  window.tippy.delegate('body', {
    target: '[data-card-url]',
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
      var url = instance.reference.dataset.cardUrl;
      if (!url) return false;
      if (cache.has(url)) {
        instance.setContent(cache.get(url));
        return;
      }
      if (instance._loading) return;
      instance._loading = true;
      fetch(url)
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          if (html) {
            cache.set(url, html);
            instance.setContent(html);
          }
        })
        .catch(function () {})
        .finally(function () { instance._loading = false; });
    },
  });
})();
