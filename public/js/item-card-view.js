// public/js/item-card-view.js
//
// Tailors a prerendered wiki item card (/base/<slug>/card, /unique/<slug>/card)
// into the Build Planner's view of that item: wiki-only cross-reference blocks
// dropped, rarity re-skinned by what has been crafted onto it, and the build's
// own chosen mods spliced into the in-game render.
//
// DOM-dependent (it edits the fetched fragment), so it lives apart from the
// node-tested pure renderers. Shared by the gear-well hover tooltip
// (builds-page.js) and the mod picker's live preview (mod-picker.js) so the two
// can never drift into showing the same item two different ways.
import { baseRarity, modCardSections } from './editor-render.js';
import { tradeQueryFilters, mergeTradeQuery, tradeActionLabel } from './trade-core.js';

/**
 * Splice `html` in after `node` and hand back the last element inserted, so a
 * caller can chain insertions and keep the running anchor.
 */
function insertAfter(node, html) {
  if (!html) return node;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const last = tpl.content.lastElementChild;
  node.after(tpl.content);
  return last || node;
}

/**
 * Retarget the card's "Search on PoE Trade" link at the item as crafted here —
 * the base/unique the card already names, narrowed by this build's chosen mods.
 *
 * The card arrives with a correct name/type link from the server, so we merge
 * into that rather than rebuilding it: no client-side name resolution, and no
 * way for the planner's link to drift from the wiki's. When some chosen mod has
 * no trade filter the label says so ("Trade (4 of 5)") rather than handing back
 * a search that quietly omits it.
 */
function retargetTradeLink(box, cell, pools, statIds, isUnique) {
  if (!statIds) return;
  const a = box.querySelector('.item-action-bar a.item-action[href]');
  if (!a) return;
  const { filters, stats, mapped, unmapped } = tradeQueryFilters({ cell, pools, statIds, isUnique });
  if (!filters && !stats) return;
  a.setAttribute('href', mergeTradeQuery(a.getAttribute('href'), { filters, stats }));
  const label = tradeActionLabel({ mapped, unmapped });
  if (!label) return;
  const span = a.querySelector('.item-action__label');
  if (span) span.textContent = label.label;
  a.setAttribute('title', label.title);
  a.setAttribute('aria-label', label.title);
  if (unmapped.length) a.classList.add('item-action--partial');
}

/**
 * @param {string} html   the fetched card fragment
 * @param {object} cell   the build's gear cell ({ item, mods, corrupted })
 * @param {object} pools  parsed mod-pools.json
 * @param {{dropArt?: boolean, statIds?: object}} opts  drop the big item art
 *        (the caller already shows it); statIds = parsed trade-stat-ids.json
 * @returns {string} the rewritten fragment HTML
 */
export function itemCardView(html, cell, pools, { dropArt = true, statIds = null } = {}) {
  const box = document.createElement('div');
  box.innerHTML = html;
  if (dropArt) box.querySelector('.itemboximage')?.remove();
  // Drop wiki-only sections that aren't part of "what you want for this build":
  // the runeforged-variants table and the "Unique versions" cross-reference.
  box.querySelectorAll('.base-card-runeforged, .base-card-uniques').forEach((sec) => {
    const sib = sec.nextElementSibling?.classList.contains('separator') ? sec.nextElementSibling
      : (sec.previousElementSibling?.classList.contains('separator') ? sec.previousElementSibling : null);
    sib?.remove();
    sec.remove();
  });
  // Rarity by chosen explicit-mod count (corrupted implicits don't count):
  // 1–2 → magic (blue), 3+ → rare (yellow), 0 stays normal (white). Uniques
  // keep their own UniquePopup styling.
  const popup = box.querySelector('.newItemPopup.NormalPopup');
  if (popup) {
    const rarity = baseRarity(cell);
    if (rarity === 'rare') popup.classList.replace('NormalPopup', 'RarePopup');
    else if (rarity === 'magic') popup.classList.replace('NormalPopup', 'MagicPopup');
  }
  // A unique keeps its own popup class — and its trade link already pins the
  // unique by name, so it needs no rarity filter on top.
  retargetTradeLink(box, cell, pools, statIds, !popup);

  const { corrupted, mods } = modCardSections(cell, pools);
  const content = box.querySelector('.content') || box.querySelector('.newItemPopup');
  if (content && (corrupted || mods)) {
    // In-game reading order, each block separated: properties / requirements /
    // crafted (corrupted) implicits / the item's own implicits / explicits.
    // Anchoring the explicits on the requirements block — as this used to —
    // pushed them ABOVE the base's implicit line, which no real item does.
    const start = content.querySelector('.requirements')?.closest('.Stats')
      || content.firstElementChild;
    if (start) {
      const afterCorrupted = insertAfter(start, corrupted);
      // Granted skills read as part of the item's intrinsic block and render
      // after its implicits, so they mark the end of "what the item already is".
      const intrinsic = content.querySelector('.card-granted') || content.querySelector('.card-implicits');
      insertAfter(intrinsic || afterCorrupted, mods);
    }
  }
  return box.innerHTML;
}
