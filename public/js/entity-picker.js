// Reusable searchable picker overlay for the build editor. Renders from
// search-index docs (the same set builds-page already loads); matching runs
// through the shared query-core so results behave exactly like /search.
import { groupQuery, GROUPS } from '/static/js/query-core.js';
import { rankDocs, esc } from '/static/js/editor-render.js';

const LABEL_FOR = new Map(GROUPS.map((g) => [g.category, g.label]));

let current = null;
export function closePicker() { current?.remove(); current = null; document.removeEventListener('keydown', onKey); }
function onKey(e) { if (e.key === 'Escape') closePicker(); }

const CAP = 40;

function rowHtml(doc) {
  const icon = doc.iconUrl
    ? `<img class="picker-row__icon" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '<span class="picker-row__icon"></span>';
  const hint = String(doc.hint || doc.subtitle || '').replace(/<[^>]*>/g, ' ');
  // The site-wide card tooltip is delegated on <body> (card-tooltip.js →
  // tippy.delegate), so simply carrying data-card-url gives every row the same
  // in-game popup the rest of the site uses — no wiring, and it works for rows
  // rendered long after page load.
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  return `<button type="button" class="picker-row" data-pick-slug="${esc(doc.slug)}" data-pick-category="${esc(doc.category)}"${card}>` +
    `${icon}<span class="picker-row__name">${esc(doc.name)}</span><span class="picker-row__hint">${esc(hint)}</span></button>`;
}

function groupHtml(label, docs) {
  const shown = docs.slice(0, CAP);
  const more = docs.length > shown.length
    ? `<p class="picker-more">+${docs.length - shown.length} more — type to narrow</p>` : '';
  return `<section class="picker-group"><h3>${esc(label)} <span>${docs.length}</span></h3>${shown.map(rowHtml).join('')}${more}</section>`;
}

/**
 * The graph's own answer to "what pairs with this gem" — recommends_support
 * edges, projected into planner.recommends. Shown as its own section rather
 * than folded into the sort order, where it was invisible.
 */
function recommendedHtml(docs, label) {
  if (!docs.length) return '';
  return `<section class="picker-group picker-group--rec">
    <h3>${esc(label)} <span>${docs.length}</span></h3>
    <p class="picker-rec-note">Suggested by the game data for this skill.</p>
    ${docs.map(rowHtml).join('')}</section>`;
}

export function openPicker({ title, docs, categories, rank = [], rankLabel = '', onPick }) {
  closePicker();
  const pool = rankDocs(docs.filter((d) => categories.includes(d.category)), rank);
  const byKey = new Map(pool.map((d) => [`${d.category}:${d.slug}`, d]));

  current = document.createElement('div');
  current.className = 'picker-overlay';
  current.innerHTML = `<div class="picker-scrim"></div>
    <div class="picker-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="picker-head"><h2>${esc(title)}</h2>
        <button class="picker-close" type="button" aria-label="Close">×</button></header>
      <input class="picker-input" type="search" placeholder="Type to search…" autocomplete="off">
      <div class="picker-results"></div>
    </div>`;
  document.body.append(current);
  document.addEventListener('keydown', onKey);

  const input = current.querySelector('.picker-input');
  const results = current.querySelector('.picker-results');

  // Recommended docs, in the graph's own order, resolved once.
  const rankSet = new Set(rank);
  const recommended = rankLabel
    ? rank.map((slug) => pool.find((d) => d.slug === slug)).filter(Boolean)
    : [];

  function render(query) {
    if (!query.trim()) {
      // The recommended set gets its own section, so drop it from the full list
      // rather than showing every entry twice.
      const rest = recommended.length ? pool.filter((d) => !rankSet.has(d.slug)) : pool;
      const groups = new Map();
      for (const d of rest) { if (!groups.has(d.category)) groups.set(d.category, []); groups.get(d.category).push(d); }
      const body = recommendedHtml(recommended, rankLabel)
        + [...groups].map(([cat, ds]) => groupHtml(
            recommended.length ? `All ${LABEL_FOR.get(cat) || cat}` : (LABEL_FOR.get(cat) || cat), ds)).join('');
      results.innerHTML = body || '<p class="picker-more">Nothing available.</p>';
      return;
    }
    const r = groupQuery(query, { docs: pool });
    results.innerHTML = r.groups.length
      ? r.groups.map((g) => groupHtml(g.label, rankDocs(g.items, rank))).join('')
      : `<p class="picker-more">No matches for <code>${esc(query)}</code>.</p>`;
  }

  input.addEventListener('input', () => render(input.value));
  current.addEventListener('click', (e) => {
    if (e.target.closest('.picker-scrim') || e.target.closest('.picker-close')) { closePicker(); return; }
    const row = e.target.closest('[data-pick-slug]');
    if (!row) return;
    const doc = byKey.get(`${row.getAttribute('data-pick-category')}:${row.getAttribute('data-pick-slug')}`);
    closePicker();
    if (doc) onPick(doc);
  });
  render('');
  input.focus();
}
