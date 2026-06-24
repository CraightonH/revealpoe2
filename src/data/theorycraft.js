import { listGems, buildGemViewModel, getGem } from './gems.js';
import { listUniques } from './uniques.js';
import { listItemClasses, getItemClass, affixBaseTargets } from './baseItems.js';
import { listKeystones, listNotables } from './passiveTree.js';
import { listModGroups } from './mods.js';
import { loadJson } from '../../scripts/graph/loader.js';
import { REPOE } from '../../scripts/graph/source.js';

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

const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ');
const norm = (parts) => stripHtml(parts.filter(Boolean).join(' ')).toLowerCase();

function gemCategory(gemType) {
  if (gemType === 'support') return 'support';
  if (gemType === 'spirit') return 'spirit';
  return 'gem'; // 'active'
}

function gemDocs() {
  const skills = loadJson(`${REPOE}/skills.json`);
  return listGems().map((g) => {
    const raw = getGem(g.slug) ?? {};
    const grants = (raw.grants_skills ?? [])
      .map((k) => skills[k]?.active_skill?.display_name)
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
