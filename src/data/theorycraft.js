import { listGems, listGemCards, buildGemViewModel, getGem } from './gems.js';
import { listUniques, listUniqueCards } from './uniques.js';
import { listItemClasses, getItemClass, affixBaseTargets } from './baseItems.js';
import { listKeystones, listNotables } from './passiveTree.js';
import { listAugments } from './augments.js';
import { listModGroups } from './mods.js';
import { getNode } from './graph.js';
import { parseQuery, docMatches, groupQuery } from '../../public/js/query-core.js';

// Query parsing/matching/grouping live in the pure, browser-shared core so
// client-side Theory Crafting can't diverge from the server. Re-export the
// pieces the tests and routes import from here.
export { parseQuery, docMatches };

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
    augment: bySlug(listAugments()),
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
  const base = groupQuery(q, { docs, capPerGroup });
  if (base.empty || !base.groups.length) return base;
  // Attach the full browse-card object to each shown item so the template can
  // render the real /gems, /uniques, /bases, /keystones card. Affixes have no
  // browse card (card stays null → template keeps the compact fallback). The
  // browser path does the same lookup against browse-cards.json.
  const groups = base.groups.map((g) => {
    const map = cardMapFor(g.category);
    return {
      ...g,
      items: g.items.map((it) => ({
        ...it,
        card: map && it.slug ? map.get(it.slug) ?? null : null,
      })),
    };
  });
  return { ...base, groups };
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
    text: norm([u.name, u.base, u.origin, ...(u.stats || []), ...(u.flavour || [])]),
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
  // Click destination is the interactive tree, centered on this node
  // (/passives?node=<hash>), not the standalone detail page — the tree shows the
  // node in context. The hover card still resolves to the detail /card fragment
  // (keystone → /keystone/:id/card, notable → /passive/:id/card), so cardUrl is
  // set explicitly rather than derived from url. A node missing its tree hash
  // (shouldn't happen for keystones/notables) falls back to the detail page.
  const cardBase = category === 'keystone' ? 'keystone' : 'passive';
  return list.map((n) => ({
    name: n.name,
    slug: n.id,
    url: n.hash != null ? `/passives?node=${n.hash}` : `/${urlBase}/${n.id}`,
    cardUrl: `/${cardBase}/${n.id}/card`,
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

// Augments have no standalone page — hover-only, like affixes: no `url`, a
// `cardUrl` to the full-tier tooltip fragment. Text spans name, family, every
// per-slot grant line, and the tier names so effect/tier searches surface them.
function augmentDocs() {
  return listAugments().map((a) => ({
    name: a.name,
    slug: a.slug,
    url: null,
    cardUrl: `/augment/${a.slug}/card`,
    category: 'augment',
    iconUrl: a.iconUrl || null,
    subtitle: a.familyLabel || '',
    color: '',
    tags: [String(a.family || '').toLowerCase(), String(a.tierLabel || '').toLowerCase()].filter(Boolean),
    req: [],
    grants: [],
    text: norm([
      a.name, a.sortName, a.familyLabel,
      ...a.categories.flatMap((c) => [c.category, ...c.lines]),
      ...a.allTiers.map((t) => t.name),
    ]),
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
    ...augmentDocs(),
  ];
  return _docs;
}
