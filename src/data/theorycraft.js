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

const GROUPS = [
  { category: 'gem',      label: 'Skill Gems' },
  { category: 'support',  label: 'Support Gems' },
  { category: 'spirit',   label: 'Spirit Skills' },
  { category: 'unique',   label: 'Unique Items' },
  { category: 'affix',    label: 'Affixes' },
  { category: 'keystone', label: 'Keystones' },
  { category: 'notable',  label: 'Notables' },
  { category: 'base',     label: 'Base Items' },
];

function termMatches(doc, term) {
  let hit;
  if (term.kind === 'text') {
    hit = doc.text.includes(term.value);
  } else {
    switch (term.field) {
      case 'type':   hit = doc.category.includes(term.value); break;
      case 'color':  hit = (doc.color || '').includes(term.value); break;
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

export function runQuery(q, { docs = allDocs(), capPerGroup = 100 } = {}) {
  const { terms } = parseQuery(q);
  const query = (q ?? '').trim();
  if (!terms.length) return { empty: true, groups: [], total: 0, query };
  const matched = docs.filter((d) => docMatches(d, terms));
  const groups = [];
  for (const g of GROUPS) {
    const items = matched.filter((d) => d.category === g.category);
    if (!items.length) continue;
    groups.push({
      category: g.category,
      label: g.label,
      total: items.length,
      shown: Math.min(items.length, capPerGroup),
      items: items.slice(0, capPerGroup),
    });
  }
  return { empty: false, groups, total: matched.length, query };
}
