// Card size control (S/M/L/XL). Sets a data-card-size attribute on <html> for
// card and page-specific content sizing. The choice is saved to localStorage;
// an inline script in base.njk applies it before first paint.
(function () {
  var KEY = 'cardSize';
  var root = document.documentElement;

  function current() {
    var s = root.getAttribute('data-card-size');
    return s === 's' || s === 'l' || s === 'xl' ? s : 'm';
  }

  function apply(size) {
    // Medium is the default — no attribute, no zoom rule.
    if (size === 'm') root.removeAttribute('data-card-size');
    else root.setAttribute('data-card-size', size);
    try { localStorage.setItem(KEY, size); } catch (e) {}
    sync();
  }

  function sync() {
    var cur = current();
    var btns = document.querySelectorAll('.card-size button[data-size]');
    for (var i = 0; i < btns.length; i++) {
      var active = btns[i].getAttribute('data-size') === cur;
      btns[i].classList.toggle('active', active);
      btns[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.card-size button[data-size]');
    if (!btn) return;
    apply(btn.getAttribute('data-size'));
  });

  sync();
})();
