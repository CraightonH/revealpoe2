import { allDocs } from './theorycraft.js';

// The global dropdown is backed by Theory Crafting's full-text document set
// (names + stat lines + tags + flavour), so a query like "life regeneration"
// surfaces gems/uniques by effect, not just by name. Name matches are ranked
// ahead of stat-text matches so "jump to the thing I named" still wins.
//
// REVERSIBLE: to go back to a name-only dropdown, match on `nameHaystack` alone
// and drop the textHits pass below.

const CATEGORY_LABEL = {
  gem: 'Skill', support: 'Support', spirit: 'Spirit',
  unique: 'Unique', affix: 'Affix', keystone: 'Keystone',
  notable: 'Notable', base: 'Base',
};

// Hover-card fragment URL. Most categories serve it at `${pageUrl}/card`;
// notables are the exception (their card lives under /passive). Affixes carry
// their own flyout cardUrl on the doc (resolved from base targets), so they're
// handled separately by the caller.
function cardUrlFor(category, url) {
  if (category === 'notable') return url.replace('/notable/', '/passive/') + '/card';
  return `${url}/card`;
}

// Round-robin order across categories. Within a tier we interleave one match
// per category per pass so a broad stat query (which can hit 100+ uniques) still
// shows variety in the capped dropdown instead of 20 of the densest category.
const CAT_ORDER = ['gem', 'support', 'spirit', 'unique', 'keystone', 'affix', 'notable', 'base'];

// Sort key for alphabetical display: lowercase, leading non-alphanumerics
// dropped so a symbol-prefixed affix ("+# to maximum Life") sorts by its first
// real letter rather than clustering under punctuation.
const alphaKey = (name) => (name || '').toLowerCase().replace(/^[^a-z0-9]+/, '');

let _docs = null;
function docs() {
  if (_docs) return _docs;
  _docs = allDocs().map((d) => {
    // Affixes show their generic mod text ("+# to maximum Life") rather than the
    // family name — the mod itself is the meaningful label in a one-line result.
    const isAffix = d.category === 'affix';
    const label = isAffix && d.genericText ? d.genericText : d.name;
    return {
      name: label,
      // Affixes may have a null page url (multi-base flyout or no base); fall
      // back to the mod typeSlug so every result still has a stable slug.
      slug: d.url ? d.url.split('/').pop() : (d.typeSlug ?? null),
      url: d.url ?? null,
      cardUrl: isAffix ? (d.cardUrl ?? null) : cardUrlFor(d.category, d.url),
      cat: d.category, // raw, for round-robin grouping
      category: CATEGORY_LABEL[d.category] ?? d.category,
      nameHaystack: label.toLowerCase(),
      textHaystack: d.text, // already stripped + lowercased by allDocs()
    };
  });
  return _docs;
}

export function search(q, limit = 20) {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return [];

  // Per category, name matches rank ahead of stat-text matches ("jump to the
  // thing I named" beats "found by effect"). Then we round-robin across the
  // categories so no single dense category (e.g. the many affixes literally
  // named for a stat) can monopolize the capped preview — every matching
  // category gets a slot before any repeats.
  const buckets = new Map(CAT_ORDER.map((c) => [c, { name: [], text: [] }]));
  for (const d of docs()) {
    if (!buckets.has(d.cat)) buckets.set(d.cat, { name: [], text: [] });
    const b = buckets.get(d.cat);
    if (d.nameHaystack.includes(needle)) b.name.push(d);
    else if (d.textHaystack.includes(needle)) b.text.push(d);
  }
  const queues = [...buckets.values()].map((b) => [...b.name, ...b.text]).filter((q) => q.length);

  const out = [];
  let drained = false;
  while (out.length < limit && !drained) {
    drained = true;
    for (const queue of queues) {
      if (queue.length) {
        out.push(queue.shift());
        drained = false;
        if (out.length >= limit) break;
      }
    }
  }
  // Relevance + round-robin above pick WHICH results make the cut (so a broad
  // query isn't stranded on "A" or flooded by one type); this final pass orders
  // the chosen set alphabetically for scanning, all types interleaved. The key
  // ignores leading symbols so "+# to maximum Life" sorts by its first letter.
  out.sort((a, b) => alphaKey(a.name).localeCompare(alphaKey(b.name)));
  return out.map((d) => ({
    name: d.name, slug: d.slug, url: d.url, cardUrl: d.cardUrl, category: d.category,
  }));
}
