// Search dropdown visibility. htmx fills #search-results on input; this hides
// that overlay when focus leaves the search box and restores it on refocus, so
// clicking elsewhere on the page dismisses the results.
(function () {
  var box = document.querySelector('.search-box');
  if (!box) return;
  var results = box.querySelector('#search-results');
  var input = box.querySelector('input[type="search"]');
  if (!results || !input) return;

  function hide() { results.style.display = 'none'; }
  function show() { results.style.display = ''; }

  // Clicking anywhere outside the search box dismisses the dropdown.
  document.addEventListener('click', function (e) {
    if (!box.contains(e.target)) hide();
  });

  input.addEventListener('keydown', function (e) {
    // Esc dismisses while keeping focus in the field.
    if (e.key === 'Escape') { hide(); return; }
    // Enter takes the full query to Theory Crafting, prepopulated and run.
    if (e.key === 'Enter') {
      var q = input.value.trim();
      if (!q) return;
      e.preventDefault();
      window.location.href = '/theorycraft?q=' + encodeURIComponent(q);
    }
  });

  // Refocusing or typing brings the (already-fetched) results back.
  input.addEventListener('focus', show);
  input.addEventListener('input', show);
})();
