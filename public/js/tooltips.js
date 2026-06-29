// Shared Tippy delegation harness for lazy, fetch-on-hover card tooltips.
// Callers (keywords.js, gem-tooltip.js, card-tooltip.js) provide a target
// selector and a way to resolve the fetch URL from the hovered element; this
// module owns the tippy guard, the shared base options + popperOptions, the
// async reposition, a single per-instance loading guard, and the in-memory
// cache + fetch routine.
//
// Exposes: window.poe2Tooltips.init({ target, resolveUrl, fallback, overrides })
(function () {
  // Fetch an HTML fragment with cache-aware error handling.
  //   - 2xx: cache and return the HTML.
  //   - 404: stable miss — cache the fallback so we don't refetch.
  //   - 5xx / other / network error: transient — return fallback but DO NOT
  //     cache, so the next hover retries.
  // Returns a Promise resolving to { html, cache }.
  function fetchFragment(url, cache, fallback) {
    if (cache.has(url)) {
      return Promise.resolve({ html: cache.get(url), cache: false });
    }
    return fetch(url)
      .then(function (r) {
        if (r.ok) {
          return r.text().then(function (html) {
            return { html: html, cache: true };
          });
        }
        // 404 is a stable miss; anything else is transient.
        return { html: fallback, cache: r.status === 404 };
      })
      .catch(function () {
        // Network error — transient, don't cache.
        return { html: fallback, cache: false };
      })
      .then(function (result) {
        if (result.cache) cache.set(url, result.html);
        return result;
      });
  }

  function init(config) {
    if (typeof window.tippy !== 'function') return;
    if (!config || !config.target || typeof config.resolveUrl !== 'function') return;

    var cache = new Map();
    var fallback = typeof config.fallback === 'string' ? config.fallback : '';
    var overrides = config.overrides || {};

    var baseOptions = {
      target: config.target,
      interactive: true,
      allowHTML: true,
      delay: [150, 80],
      maxWidth: 'none',
      theme: 'poe2',
      placement: 'right-start',
      // Honour fullscreen: a popper appended to document.body sits outside the
      // fullscreen element's top-layer subtree and won't render (e.g. keyword
      // tooltips inside the fullscreen passive tree). Falls back to body when
      // nothing is fullscreen, preserving site-wide behaviour.
      appendTo: function () { return document.fullscreenElement || document.body; },
      // Keep the popup inside the viewport so tall tooltips don't spill off the
      // top; paired with the max-height cap in app.css. altAxis pins the
      // vertical axis too (default preventOverflow only does the main axis),
      // and tether:false lets the box detach from the reference so it shifts
      // fully into view. fallbackPlacements is applied for every caller (this
      // used to be missing on keyword tooltips — bugfix by consolidation).
      popperOptions: {
        modifiers: [
          { name: 'preventOverflow', options: { padding: 8, altAxis: true, tether: false } },
          { name: 'flip', options: { padding: 8, fallbackPlacements: ['left-start', 'right', 'left'] } },
        ],
      },
      // Content loads async; reposition once it lands so the placement reflects
      // the final (taller) size rather than the small loading box.
      onShown: function (instance) {
        if (instance.popperInstance) instance.popperInstance.update();
      },
      // Returning from an inner tooltip to the card body (item > skill > item):
      // the ancestor card tooltip was hidden when the inner one opened, and
      // moving within the card fires no new mouseenter to re-trigger it. So when
      // the inner one hides, re-show the nearest still-hovered ancestor card.
      onHidden: function (instance) {
        for (var p = instance.reference.parentElement; p; p = p.parentElement) {
          if (p._tippy && p.matches && p.matches('[data-card-url]:hover')) {
            p._tippy.show();
            break;
          }
        }
      },
      content: fallback,
      onShow: function (instance) {
        var ref = instance.reference;
        // Nested tooltips: a card-url target can sit inside another (e.g. a
        // "Grants Skill" link inside a base-item card). Show only the innermost.
        //  - If a descendant card-url target is currently hovered, this instance
        //    is the ancestor — don't show it.
        //  - Otherwise hide any already-open ancestor tooltip so the inner one
        //    replaces it rather than stacking on top.
        if (ref.querySelector && ref.querySelector('[data-card-url]:hover')) return false;
        // Only collapse a genuinely nested card target (e.g. skill link inside a
        // base-item card) — match on [data-card-url] in the page DOM, NOT any
        // element with a _tippy. Tippy stamps _tippy on its popper too, so an
        // unrestricted walk would hide the very tooltip a keyword lives inside
        // (keyword tooltips render in a body-appended popper), cascading shut.
        for (var p = ref.parentElement; p; p = p.parentElement) {
          if (p.matches && p.matches('[data-card-url]') && p._tippy && p._tippy !== instance) p._tippy.hide();
        }
        var url = config.resolveUrl(instance.reference);
        if (!url) return false;
        if (cache.has(url)) {
          instance.setContent(cache.get(url));
          return;
        }
        if (instance._poe2Loading) return;
        instance._poe2Loading = true;
        fetchFragment(url, cache, fallback)
          .then(function (result) {
            instance.setContent(result.html);
          })
          .finally(function () { instance._poe2Loading = false; });
      },
    };

    // Apply caller overrides (e.g. keyword tooltips keep their narrower
    // maxWidth and loading content). Top-level keys only — matches existing
    // option shapes.
    for (var key in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        baseOptions[key] = overrides[key];
      }
    }

    window.tippy.delegate('body', baseOptions);
  }

  window.poe2Tooltips = { init: init, fetchFragment: fetchFragment };
})();
