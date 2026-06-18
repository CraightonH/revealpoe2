// Affix family rows are accordions: clicking one toggles the hidden tier
// sub-table that follows it. Multiple rows can stay open at once. Tiers are
// already in the DOM (server-rendered), so there is no network round-trip.
(function () {
  function toggle(row) {
    var tiers = row.nextElementSibling;
    if (!tiers || !tiers.classList.contains('affix-tiers')) return;
    var open = row.getAttribute('aria-expanded') === 'true';
    row.setAttribute('aria-expanded', open ? 'false' : 'true');
    tiers.hidden = open;
  }

  document.addEventListener('click', function (e) {
    var row = e.target.closest('.affix-row');
    if (row) toggle(row);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target.closest('.affix-row');
    if (!row) return;
    e.preventDefault();
    toggle(row);
  });
})();
