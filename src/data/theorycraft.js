import { listGems, buildGemViewModel, getGem } from './gems.js';
import { listUniques } from './uniques.js';
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

export function runQuery(q, { docs = allDocs(), capPerGroup = 100 } = {}) {
  return groupQuery(q, { docs, capPerGroup });
}

const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ');
// Flatten RePoE keyword markup to its display words for the search blob:
// "[ElementalDamage|Elemental] Damage with [Attack|Attacks]" -> "Elemental Damage with Attacks".
const stripKw = (s) => String(s ?? '').replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1').replace(/\[([^\]|]*)\]/g, '$1');
// Collapse whitespace runs to single spaces: stripHtml turns each tag into a
// space, so keyword-marked text ("[Charges|Power Charge]") renders with double
// spaces around the keyword. Substring queries use single spaces, so without this
// a multi-word effect search ("power charge consumed") wouldn't match the blob.
const norm = (parts) => stripHtml(parts.filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim().toLowerCase();

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
    let hint = '';
    try {
      const vm = buildGemViewModel(g.slug);
      subtitle = vm.typeLine || '';
      hint = vm.description || vm.sections.flatMap((s) => s.lines || [])[0] || subtitle;
      // Effect text spans each section's base lines PLUS its quality effects: the
      // standard quality bonus and the Gemling Legionnaire alternate ("second")
      // quality (altQuality). Without these, a query for a quality-only effect
      // (e.g. Falling Thunder's Gemling "chance to not consume a charge") matches
      // nothing. Both indices (server search + client search-index.json) read this
      // blob, so indexing here covers both.
      textParts = [vm.name, vm.typeLine, ...(vm.tags || []), vm.description,
        ...vm.sections.flatMap((s) => [...s.lines, ...(s.quality || []), ...(s.altQuality || [])]),
        ...grants];
    } catch {
      textParts = [g.name, ...grants];
    }
    return {
      name: g.name,
      slug: g.slug,
      url: `/gems#${g.slug}`,
      cardUrl: `/gem/${g.slug}/card`,
      category: gemCategory(g.gemType),
      iconUrl: g.iconUrl || null,
      subtitle,
      hint,
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
    url: `/uniques#${u.slug}`,
    cardUrl: `/unique/${u.slug}/card`,
    category: 'unique',
    iconUrl: u.iconUrl || null,
    // Pool-driven uniques have no fixed base or stats, so fall back to the
    // descriptive baseLabel ("Any Body Armour") for the type line.
    subtitle: u.base || u.baseLabel || '',
    hint: u.stats?.[0] || u.base || u.baseLabel || '',
    color: '',
    tags: [String(u.itemClass || '').toLowerCase()].filter(Boolean),
    req: [],
    grants: [],
    origin: (u.origin || '').toLowerCase(),
    // poolText carries a pool-driven unique's craftable mods — without it
    // Loreweave would be findable only by name, never by what it can roll.
    text: norm([
      u.name, u.base, u.baseLabel, u.origin,
      ...(u.stats || []), ...(u.flavour || []),
      ...(u.cultivatedText || []).map(stripKw),
      ...(u.poolText || []).map(stripKw),
    ]),
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
        slug: g.typeSlug,
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
        hint: g.text,
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
    hint: n.statRaw || n.flavourText || '',
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
    hint: a.categories.flatMap((c) => c.lines)[0] || a.familyLabel || '',
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
        url: `/bases#${b.classSlug}`,
        cardUrl: `/base/${b.slug}/card`,
        category: 'base',
        classSlug: b.classSlug,
        iconUrl: b.iconUrl || null,
        subtitle: c?.className || '',
        hint: b.implicits?.[0]?.html || b.properties?.[0]?.value || c?.className || '',
        color: '',
        tags: b.tags || [],
        req: [],
        grants: [],
        text: norm([
          b.name, c?.className, ...(b.tags || []),
          ...(b.properties || []).flatMap((property) => [property.label, property.value]),
          ...(b.requirements || []),
          ...(b.implicits || []).map((implicit) => implicit.html),
          ...(b.grantedSkills || []).map((skill) => skill.name),
        ]),
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
