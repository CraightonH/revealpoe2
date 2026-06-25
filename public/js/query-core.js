// Pure, dependency-free query engine shared by the SERVER
// (src/data/theorycraft.js, src/data/search.js) and the BROWSER
// (search-client.js, theorycraft-client.js). Keeping the matching/ranking logic
// in one file is what guarantees client-side results can never diverge from the
// server's. It operates only on the plain "doc" objects produced by allDocs()
// — no Node or DOM APIs — so the same file is importable by Node and served to
// the browser at /static/js/query-core.js.

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

const FIELDS = new Set(['type', 'color', 'tag', 'req', 'grants']);

// Tokenize a raw query into terms, honoring "quoted phrases", -exclusion,
// and field:value. Bare words, quoted phrases, and unknown field names all
// become free-text terms (the unknown field name is dropped). Never throws.
export function parseQuery(q) {
  const terms = [];
  const re = /(-?)(?:([a-zA-Z]+):)?(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(q ?? '')) !== null) {
    if (m[0].trim() === '') { re.lastIndex++; continue; }
    const negate = m[1] === '-';
    const rawField = m[2] ? m[2].toLowerCase() : null;
    const value = (m[3] !== undefined ? m[3] : (m[4] ?? '')).toLowerCase();
    if (!value) continue;
    if (rawField && FIELDS.has(rawField)) {
      terms.push({ kind: 'field', field: rawField, value, negate });
    } else {
      terms.push({ kind: 'text', value, negate });
    }
  }
  return { terms };
}

const COLOR_WORDS = { red: 'r', green: 'g', blue: 'b', white: 'w' };

function termMatches(doc, term) {
  let hit;
  if (term.kind === 'text') {
    hit = doc.text.includes(term.value);
  } else {
    switch (term.field) {
      case 'type':   hit = doc.category.includes(term.value); break;
      case 'color': {
        const v = COLOR_WORDS[term.value] ?? term.value;
        hit = (doc.color || '').includes(v);
        break;
      }
      case 'tag':    hit = doc.tags.some((t) => t.includes(term.value)); break;
      case 'req':    hit = doc.req.some((r) => r.includes(term.value)); break;
      case 'grants': hit = doc.grants.some((g) => g.includes(term.value)); break;
      default:       hit = doc.text.includes(term.value);
    }
  }
  return term.negate ? !hit : hit;
}

export function docMatches(doc, terms) {
  return terms.every((t) => termMatches(doc, t));
}

// ---------------------------------------------------------------------------
// Theory Crafting: grouped results (no card attachment — the presentation
// layer, server macros or browse-cards.json, supplies the rendered card)
// ---------------------------------------------------------------------------

export const GROUPS = [
  { category: 'gem',      label: 'Skill Gems' },
  { category: 'support',  label: 'Support Gems' },
  { category: 'spirit',   label: 'Spirit Skills' },
  { category: 'unique',   label: 'Unique Items' },
  { category: 'affix',    label: 'Affixes' },
  { category: 'keystone', label: 'Keystones' },
  { category: 'notable',  label: 'Notables' },
  { category: 'base',     label: 'Base Items' },
];

// Run a query over `docs`, returning grouped raw matches. Mirrors the shape the
// theorycraft template expects: { empty, groups:[{category,label,total,shown,
// items}], total, query }. Items are the raw docs; callers attach render data.
export function groupQuery(q, { docs, capPerGroup = 100 } = {}) {
  const { terms } = parseQuery(q);
  const query = (q ?? '').trim();
  if (!terms.length) return { empty: true, groups: [], total: 0, query };
  const matched = docs.filter((d) => docMatches(d, terms));
  const groups = [];
  for (const g of GROUPS) {
    const items = matched.filter((d) => d.category === g.category);
    if (!items.length) continue;
    const shown = items.slice(0, capPerGroup);
    groups.push({
      category: g.category,
      label: g.label,
      total: items.length,
      shown: shown.length,
      items: shown,
    });
  }
  return { empty: false, groups, total: matched.length, query };
}

// ---------------------------------------------------------------------------
// Global search dropdown: ranked, round-robin preview across categories
// ---------------------------------------------------------------------------

const CATEGORY_LABEL = {
  gem: 'Skill', support: 'Support', spirit: 'Spirit',
  unique: 'Unique', affix: 'Affix', keystone: 'Keystone',
  notable: 'Notable', base: 'Base',
};

// Hover-card fragment URL. Most categories serve it at `${pageUrl}/card`;
// notables are the exception (their card lives under /passive).
function cardUrlFor(category, url) {
  if (category === 'notable') return url.replace('/notable/', '/passive/') + '/card';
  return `${url}/card`;
}

// Round-robin order across categories for the capped dropdown.
const CAT_ORDER = ['gem', 'support', 'spirit', 'unique', 'keystone', 'affix', 'notable', 'base'];

// Lowercase, leading non-alphanumerics dropped so a symbol-prefixed affix
// ("+# to maximum Life") sorts by its first real letter.
const alphaKey = (name) => (name || '').toLowerCase().replace(/^[^a-z0-9]+/, '');

// Project allDocs() into the lighter doc shape the dropdown ranks over (name
// label, name/text haystacks, resolved card URL). Affixes show their generic
// mod text and carry a flyout cardUrl; everything else gets `${url}/card`.
export function toSearchDocs(rawDocs) {
  return rawDocs.map((d) => {
    const isAffix = d.category === 'affix';
    const label = isAffix && d.genericText ? d.genericText : d.name;
    return {
      name: label,
      slug: d.url ? d.url.split('/').pop() : (d.typeSlug ?? null),
      url: d.url ?? null,
      cardUrl: isAffix ? (d.cardUrl ?? null) : cardUrlFor(d.category, d.url),
      cat: d.category,
      category: CATEGORY_LABEL[d.category] ?? d.category,
      nameHaystack: label.toLowerCase(),
      textHaystack: d.text,
    };
  });
}

// Rank search docs for a needle. Per category, name matches outrank stat-text
// matches; then round-robin across categories so the capped preview shows
// variety; finally order the chosen set alphabetically for scanning.
export function searchRank(searchDocs, q, limit = 20) {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return [];

  const buckets = new Map(CAT_ORDER.map((c) => [c, { name: [], text: [] }]));
  for (const d of searchDocs) {
    if (!buckets.has(d.cat)) buckets.set(d.cat, { name: [], text: [] });
    const b = buckets.get(d.cat);
    if (d.nameHaystack.includes(needle)) b.name.push(d);
    else if (d.textHaystack.includes(needle)) b.text.push(d);
  }
  const queues = [...buckets.values()].map((b) => [...b.name, ...b.text]).filter((qq) => qq.length);

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
  out.sort((a, b) => alphaKey(a.name).localeCompare(alphaKey(b.name)));
  return out.map((d) => ({
    name: d.name, slug: d.slug, url: d.url, cardUrl: d.cardUrl, category: d.category,
  }));
}
