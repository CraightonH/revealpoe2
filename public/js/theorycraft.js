// Theory Crafting search help: clicking an example chip runs that query.
// Sets the search input's value and dispatches an `input` event, which fires
// the input's existing htmx trigger (input changed delay:200ms, search).
(function () {
  var input = document.querySelector('.tc-input');
  if (!input) return;
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.tc-example');
    if (!btn) return;
    e.preventDefault();
    input.value = btn.dataset.q || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    var help = document.querySelector('.tc-help');
    if (help) help.open = false;
    input.focus();
    var n = input.value.length;
    try { input.setSelectionRange(n, n); } catch (err) { /* type=search may reject */ }
  });
})();
