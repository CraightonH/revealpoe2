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
    // Keep the popup inside the viewport so tall tooltips don't spill off the
    // top; paired with the max-height cap in app.css.
    popperOptions: {
      modifiers: [
        // altAxis pins the vertical axis too (default preventOverflow only does
        // the main axis), and tether:false lets the box detach from the
        // reference so it shifts fully into view instead of spilling off the top.
        { name: 'preventOverflow', options: { padding: 8, altAxis: true, tether: false } },
        { name: 'flip', options: { padding: 8 } },
      ],
    },
    // Content loads async; reposition once it lands so the placement reflects
    // the final (taller) size rather than the small "Loading…" box.
    onShown: function (instance) {
      if (instance.popperInstance) instance.popperInstance.update();
    },
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
        .then(function (r) {
          // Cache real hits and real 404s (missing keyword = stable). Treat any
          // other status (5xx, etc.) as transient: show the fallback but don't
          // cache it, so the next hover retries.
          if (r.ok) return r.text().then(function (html) { return { cache: true, html: html }; });
          return { cache: r.status === 404, html: null };
        })
        .then(function (result) {
          var val = result.html || 'No description available.';
          if (result.cache) cache.set(key, val);
          instance.setContent(val);
        })
        .catch(function () {
          // Network error — transient, don't cache.
          instance.setContent('No description available.');
        })
        .finally(function () { instance._kwLoading = false; });
    },
  });
})();
