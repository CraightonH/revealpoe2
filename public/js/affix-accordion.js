// Affix families are accordions: the always-visible first row is the top tier
// (T1); clicking it toggles the lower-tier rows (T2..Tn) that follow it in the
// same tbody. Tiers are server-rendered, so there is no network round-trip.
(function () {
  function lowerRows(row) {
    var rows = [];
    var el = row.nextElementSibling;
    while (el && el.classList.contains('affix-tier-row')) {
      rows.push(el);
      el = el.nextElementSibling;
    }
    return rows;
  }

  function toggle(row) {
    var rows = lowerRows(row);
    if (!rows.length) return;
    var open = row.getAttribute('aria-expanded') === 'true';
    row.setAttribute('aria-expanded', open ? 'false' : 'true');
    rows.forEach(function (r) { r.hidden = open; });
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
