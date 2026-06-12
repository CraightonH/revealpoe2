// Lazy keyword tooltips. One delegated Tippy instance handles every `.kw`
// (including spans injected inside open tooltips). Each keyword's fragment is
// fetched once from /api/keyword/:key and cached in memory.
(function () {
  if (typeof window.tippy !== 'function') return;

  var cache = new Map();

  window.tippy.delegate('body', {
    target: '.kw',
    interactive: true,
    allowHTML: true,
    delay: [120, 80],
    maxWidth: 360,
    theme: 'poe2',
    appendTo: function () { return document.body; },
    content: 'Loading…',
    onShow: function (instance) {
      var key = instance.reference.getAttribute('data-keyword');
      if (!key) return;
      if (cache.has(key)) {
        instance.setContent(cache.get(key));
        return;
      }
      if (instance._kwLoading) return;
      instance._kwLoading = true;
      fetch('/api/keyword/' + encodeURIComponent(key))
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          var val = html || 'No description available.';
          cache.set(key, val);
          instance.setContent(val);
        })
        .catch(function () {
          instance.setContent('No description available.');
        })
        .finally(function () { instance._kwLoading = false; });
    },
  });
})();
