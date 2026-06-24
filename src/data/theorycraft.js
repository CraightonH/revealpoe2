import { listGems, listGemCards, buildGemViewModel, getGem } from './gems.js';
import { listUniques, listUniqueCards } from './uniques.js';
import { listItemClasses, getItemClass, affixBaseTargets } from './baseItems.js';
import { listKeystones, listNotables } from './passiveTree.js';
import { listModGroups } from './mods.js';
import { getNode } from './graph.js';

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

// Per-category slug → browse-card lookup. The same condensed card objects the
// /gems, /uniques, /bases and /keystones pages render, so theorycraft results
// can reuse those macros verbatim instead of a bespoke result card. Built once
// (same cost the browse pages pay) and cached. gem/support/spirit share one map.
let _cardMaps = null;
function cardMaps() {
  if (_cardMaps) return _cardMaps;
  const bySlug = (list) => new Map(list.map((c) => [c.slug, c]));
  const byId = (list) => new Map(list.map((c) => [c.id, c]));
  const bases = listItemClasses().flatMap((group) =>
    group.classes.flatMap((cls) => getItemClass(cls.classSlug)?.bases ?? [])
  );
  _cardMaps = {
    gem: bySlug(listGemCards()),
    unique: bySlug(listUniqueCards()),
    base: bySlug(bases),
    keystone: byId(listKeystones()),
    notable: byId(listNotables()),
  };
  return _cardMaps;
}

// Which lookup map serves a result category (gem/support/spirit all map to gems).
function cardMapFor(category) {
  const maps = cardMaps();
  if (category === 'support' || category === 'spirit') return maps.gem;
  return maps[category] ?? null;
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
    // Attach the full browse-card object to each shown item so the template can
    // render the real /gems, /uniques, /bases, /keystones card. Affixes have no
    // browse card (card stays null → template keeps the compact fallback).
    const map = cardMapFor(g.category);
    const shown = items.slice(0, capPerGroup).map((it) => ({
      ...it,
      card: map && it.slug ? map.get(it.slug) ?? null : null,
    }));
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

const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ');
const norm = (parts) => stripHtml(parts.filter(Boolean).join(' ')).toLowerCase();

function gemCategory(gemType) {
  if (gemType === 'support') return 'support';
  if (gemType === 'spirit') return 'spirit';
  return 'gem'; // 'active'
}

function gemDocs() {
  return listGems().map((g) => {
    const raw = getGem(g.slug) ?? {};
    const grants = (raw.grants_skills ?? [])
      .map((k) => {
        const n = getNode(k);
        // Skill nodes fall back to name = key when the source display_name is
        // empty; those are not real names — drop them (matches the prior
        // skills.json `.filter(Boolean)` behavior) so internal keys never enter
        // the search index.
        return n && n.name !== n.id ? n.name : null;
      })
      .filter(Boolean);
    let textParts = [g.name];
    let subtitle = '';
    try {
      const vm = buildGemViewModel(g.slug);
      subtitle = vm.typeLine || '';
      textParts = [vm.name, vm.typeLine, ...(vm.tags || []), vm.description,
        ...vm.sections.flatMap((s) => s.lines), ...grants];
    } catch {
      textParts = [g.name, ...grants];
    }
    return {
      name: g.name,
      slug: g.slug,
      url: `/gem/${g.slug}`,
      category: gemCategory(g.gemType),
      iconUrl: g.iconUrl || null,
      subtitle,
      color: g.color || '',
      tags: (raw.tags ?? []).map((t) => String(t).toLowerCase()),
      req: g.req || [],
      grants: grants.map((s) => s.toLowerCase()),
      text: norm(textParts),
    };
  });
}

function uniqueDocs() {
  return listUniques().map((u) => ({
    name: u.name,
    slug: u.slug,
    url: `/unique/${u.slug}`,
    category: 'unique',
    iconUrl: u.iconUrl || null,
    subtitle: u.base || '',
    color: '',
    tags: [String(u.itemClass || '').toLowerCase()].filter(Boolean),
    req: [],
    grants: [],
    text: norm([u.name, u.base, ...(u.stats || []), ...(u.flavour || [])]),
  }));
}

function affixDocs() {
  return listModGroups()
    .filter((g) => g.text)
    .map((g) => {
      // No dedicated mod page: resolve where this affix can actually roll.
      // One base target → direct link; several → hover flyout.
      const targets = affixBaseTargets(g.typeSlug);
      // Affixes that roll on no browsable base (unique-granted, weight-0,
      // essence-only…) aren't meaningful in isolation — and the /bases affix
      // tables don't list them either. Drop them rather than show a dead result.
      if (!targets.length) return null;
      return {
        name: g.displayName,
        genericText: g.genericText, // compact generic form, used as the search-bar label
        typeSlug: g.typeSlug,
        // Every affix gets the "Can roll on" flyout on hover. A single-base affix
        // also links directly (click-through); multi-base has no direct url, so
        // the flyout is the way to pick a base (and gets the chevron cue).
        url: targets.length === 1 ? targets[0].href : null,
        cardUrl: `/mod/${g.typeSlug}/card`,
        category: 'affix',
        iconUrl: null,
        subtitle: g.text,
        color: '',
        tags: [g.generation_type].filter(Boolean),
        req: [],
        grants: [],
        text: norm([g.displayName, g.text]),
      };
    })
    .filter(Boolean);
}

function nodeDocs(list, category, urlBase) {
  return list.map((n) => ({
    name: n.name,
    slug: n.id,
    url: `/${urlBase}/${n.id}`,
    category,
    iconUrl: n.iconUrl || null,
    subtitle: '',
    color: '',
    tags: [],
    req: [],
    grants: [],
    text: norm([n.name, n.statRaw, n.flavourText]),
  }));
}

function baseDocs() {
  return listItemClasses().flatMap((group) =>
    group.classes.flatMap((cls) => {
      const c = getItemClass(cls.classSlug);
      return (c?.bases ?? []).map((b) => ({
        name: b.name,
        slug: b.slug,
        url: `/base/${b.slug}`,
        category: 'base',
        iconUrl: b.iconUrl || null,
        subtitle: c?.className || '',
        color: '',
        tags: [],
        req: [],
        grants: [],
        text: norm([b.name, c?.className]),
      }));
    })
  );
}

let _docs = null;

export function allDocs() {
  if (_docs) return _docs;
  _docs = [
    ...gemDocs(),
    ...uniqueDocs(),
    ...affixDocs(),
    ...nodeDocs(listKeystones(), 'keystone', 'keystone'),
    ...nodeDocs(listNotables(), 'notable', 'notable'),
    ...baseDocs(),
  ];
  return _docs;
}
