// Gem quality input. Mirrors gem-level-select.js: pure text toggling over server-rendered
// HTML, no data resolution here, so the static build behaves identically to the dev server.
// The card renders every quality line's range number as a `.qual-tok` span (default text =
// its "(0—N)" range, also in data-range). On input we recompute those spans from the gem's
// embedded breakpoint series — the SAME data the Scaling→Quality table is built from, so the
// card can never disagree with the table. Empty / 0 restores the range.
import { lookupQuality } from '/static/js/gem-quality-core.js';

document.querySelectorAll('.gem-quality-input').forEach(function (input) {
  // Scope to this gem's card so multiple cards on a page (e.g. /theorycraft) stay independent.
  var card = input.closest('.newItemPopup') || document;
  var dataEl = card.querySelector('.gem-quality-data');
  var series = {};
  if (dataEl) { try { series = JSON.parse(dataEl.textContent); } catch (e) { series = {}; } }

  // Update EVERY .qual-tok in the card, including spans inside hidden gem-level variants, so
  // switching level after typing a quality keeps the recomputed values.
  function apply(raw) {
    var Q = parseInt(raw, 10);
    if (!Number.isFinite(Q) || Q < 0) Q = 0;
    if (Q > 100) Q = 100;
    card.querySelectorAll('.qual-tok').forEach(function (span) {
      if (Q < 1) { span.textContent = span.dataset.range; return; } // 0 / empty → range
      var cell = lookupQuality(series, span.dataset.col, Q);
      if (cell == null) { span.textContent = '0'; return; } // below first breakpoint
      var parts = String(cell).split(' / ');            // multi-token cell → per-token value
      var idx = Number(span.dataset.idx) || 0;
      span.textContent = parts[idx] != null ? parts[idx] : cell;
    });
  }

  input.addEventListener('input', function () { apply(input.value); });
  // Default value is 0 → the server-rendered ranges already show; no initial apply needed.
});
