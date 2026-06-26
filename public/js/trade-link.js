// Delegated handler for the "Search on PoE Trade" button on condensed cards.
// Those cards are themselves <a> elements, so the trade affordance is a
// <span data-trade-url> rather than a nested <a>. We intercept its click/keydown,
// stop it from triggering the parent card's navigation, and open the trade URL in
// a new tab. Full tooltip popups use a real <a> and don't need this.
(function () {
  function openTrade(el) {
    var url = el.getAttribute('data-trade-url');
    if (url) window.open(url, '_blank', 'noopener');
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-trade-url]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    openTrade(el);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = e.target.closest ? e.target.closest('[data-trade-url]') : null;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    openTrade(el);
  });
})();
