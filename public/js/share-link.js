// Delegated handler for the "Share" button in the item action bar
// (data-share-kind/-slug/-name, emitted by views/macros/item-actions.njk).
// Pattern: trade-link.js (click + keyboard, stopPropagation so parent card
// navigation doesn't fire).
//
// Native Web Share sheet where the platform supports it (mobile); otherwise
// copy the detail-page URL to the clipboard, with the same prompt fallback
// build-editor.js uses when the clipboard API is unavailable.
(function () {
  function shareUrl(el) {
    var kind = el.getAttribute('data-share-kind');
    var slug = el.getAttribute('data-share-slug');
    return location.origin + '/' + kind + '/' + encodeURIComponent(slug);
  }

  function confirmCopy(el) {
    var label = el.querySelector('.item-action__label');
    if (!label) return;
    var original = label.textContent;
    label.textContent = 'Copied ✓';
    setTimeout(function () { label.textContent = original; }, 1800);
  }

  function fallbackCopy(el, url) {
    var done = function () { confirmCopy(el); };
    var fail = function () { window.prompt('Copy this share link:', url); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fail);
    } else {
      fail();
    }
  }

  function activate(el) {
    var url = shareUrl(el);
    var title = el.getAttribute('data-share-name') || undefined;
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function (err) {
        // User dismissed the sheet; any other failure degrades to copy.
        if (err && err.name !== 'AbortError') fallbackCopy(el, url);
      });
      return;
    }
    fallbackCopy(el, url);
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-share-kind]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    activate(el);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = e.target.closest ? e.target.closest('[data-share-kind]') : null;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    activate(el);
  });
})();
