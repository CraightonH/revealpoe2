// test/graph/manual.test.js — guardrails for the hand-crafted data overlay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlays } from '../../scripts/graph/manual.js';

// Minimal source graph: one default-skill gem + two bow bases in class 'bow'.
const sourceNodes = [
  { id: 'Gem/Bow', kind: 'gem', name: 'Bow Shot', slug: 'bow-shot', props: {}, source: 'repoe' },
  { id: 'Base/Bow1', kind: 'base', name: 'Crude Bow', slug: 'crude-bow', props: { classSlug: 'bow' }, source: 'repoe' },
  { id: 'Base/Bow2', kind: 'base', name: 'Shortbow', slug: 'shortbow', props: { classSlug: 'bow' }, source: 'repoe' },
];
const wds = (map) => [{ name: 'weapon-default-skills', data: { kind: 'weapon-default-skills', map } }];

test('expands a weapon-default-skills rule into derived default_skill edges', () => {
  const r = applyOverlays({ nodes: sourceNodes, edges: [], overlays: wds({ 'Gem/Bow': 'bow' }) });
  assert.equal(r.errors.length, 0);
  assert.equal(r.edges.length, 2, 'one edge per base in the class');
  assert.ok(r.edges.every((e) => e.type === 'default_skill' && e.to === 'Gem/Bow'));
  assert.ok(r.edges.every((e) => e.source === 'derived' && e.via === 'manual:weapon-default-skills'));
  assert.deepEqual(r.edges.map((e) => e.from).sort(), ['Base/Bow1', 'Base/Bow2']);
});

test('a gem may serve multiple classes via an array value', () => {
  const nodes = [
    ...sourceNodes,
    { id: 'Base/Axe1', kind: 'base', name: 'Axe', slug: 'axe', props: { classSlug: 'one-hand-axe' }, source: 'repoe' },
    { id: 'Base/Axe2', kind: 'base', name: 'Greataxe', slug: 'greataxe', props: { classSlug: 'two-hand-axe' }, source: 'repoe' },
    { id: 'Gem/Axe', kind: 'gem', name: 'Axe Slash', slug: 'axe-slash', props: {}, source: 'repoe' },
  ];
  const r = applyOverlays({
    nodes,
    edges: [],
    overlays: [{ name: 'weapon-default-skills', data: { kind: 'weapon-default-skills', map: { 'Gem/Axe': ['one-hand-axe', 'two-hand-axe'] } } }],
  });
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.edges.map((e) => e.from).sort(), ['Base/Axe1', 'Base/Axe2']);
  assert.ok(r.edges.every((e) => e.to === 'Gem/Axe'));
});

test('referential integrity: an unresolved gem key is a build error', () => {
  const r = applyOverlays({ nodes: sourceNodes, edges: [], overlays: wds({ 'Gem/Renamed': 'bow' }) });
  assert.equal(r.edges.length, 0);
  assert.ok(r.errors.some((e) => /not a live gem node/.test(e)));
});

test('referential integrity: a class slug with no bases is a build error', () => {
  const r = applyOverlays({ nodes: sourceNodes, edges: [], overlays: wds({ 'Gem/Bow': 'nonexistent-class' }) });
  assert.equal(r.edges.length, 0);
  assert.ok(r.errors.some((e) => /has no bases/.test(e)));
});

test('retirement detection: drops + warns when source already has the relationship', () => {
  // Source now expresses the same default_skill edge for Base/Bow1.
  const sourceEdges = [{ type: 'default_skill', from: 'Base/Bow1', to: 'Gem/Bow', source: 'repoe' }];
  const r = applyOverlays({ nodes: sourceNodes, edges: sourceEdges, overlays: wds({ 'Gem/Bow': 'bow' }) });
  assert.equal(r.errors.length, 0);
  assert.equal(r.edges.length, 1, 'the source-duplicated edge is dropped');
  assert.equal(r.edges[0].from, 'Base/Bow2');
  assert.ok(r.warnings.some((w) => /retire .*source now provides/.test(w)));
});

test('unknown overlay kind is a build error', () => {
  const r = applyOverlays({ nodes: sourceNodes, edges: [], overlays: [{ name: 'x', data: { kind: 'bogus' } }] });
  assert.ok(r.errors.some((e) => /unknown overlay kind 'bogus'/.test(e)));
});

// --- gear-slots overlay -----------------------------------------------------
const gearNodes = [
  { id: 'Base/Helm1', kind: 'base', name: 'Iron Helm', slug: 'iron-helm', props: { itemClass: 'Helmet', classSlug: 'helmet', tags: ['helmet','armour'] }, source: 'repoe' },
  { id: 'Base/2HMace1', kind: 'base', name: 'Great Mace', slug: 'great-mace', props: { itemClass: 'Two Hand Mace', classSlug: 'two-hand-mace', tags: ['mace','twohand','weapon'] }, source: 'repoe' },
  { id: 'Base/Quiver1', kind: 'base', name: 'Broadhead Quiver', slug: 'broadhead-quiver', props: { itemClass: 'Quiver', classSlug: 'quiver', tags: ['quiver'] }, source: 'repoe' },
  { id: 'Base/Bow1', kind: 'base', name: 'Crude Bow', slug: 'crude-bow', props: { itemClass: 'Bow', classSlug: 'bow', tags: ['bow', 'weapon'] }, source: 'repoe' },
];
const gearOverlay = (data) => [{ name: 'gear-slots', data: { kind: 'gear-slots', ...data } }];
const SLOTS = [
  { id: 'helmet', name: 'Helmet', accepts: 'helmet', order: 5 },
  { id: 'weapon1a', name: 'Main Hand (Set I)', group: 'weaponset1', accepts: 'weapon', order: 1 },
  { id: 'weapon2a', name: 'Main Hand (Set II)', group: 'weaponset2', accepts: 'weapon', order: 3 },
  { id: 'weapon1b', name: 'Off Hand (Set I)', group: 'weaponset1', accepts: 'offhand', order: 2 },
  { id: 'weapon2b', name: 'Off Hand (Set II)', group: 'weaponset2', accepts: 'offhand', order: 4 },
];

test('gear-slots: emits gear-slot nodes and derived fits_slot edges per base', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Helmet', slots: ['helmet'] }] }),
  });
  assert.equal(r.errors.length, 0, r.errors.join('\n'));
  const slotNodes = r.nodes.filter((n) => n.kind === 'gear-slot');
  assert.equal(slotNodes.length, 5);
  const helmetNode = slotNodes.find((n) => n.slug === 'helmet');
  assert.equal(helmetNode.id, 'Slot/helmet');
  assert.equal(helmetNode.source, 'manual');
  const fits = r.edges.filter((e) => e.type === 'fits_slot');
  assert.equal(fits.length, 1);
  assert.equal(fits[0].from, 'Base/Helm1');
  assert.equal(fits[0].to, 'Slot/helmet');
  assert.equal(fits[0].source, 'derived');
  assert.equal(fits[0].via, 'manual:gear-slots');
});

test('gear-slots: a weapon class maps to both main-hand slots', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Two Hand Mace', slots: ['weapon1a', 'weapon2a'] }] }),
  });
  assert.equal(r.errors.length, 0);
  const to = r.edges.filter((e) => e.type === 'fits_slot').map((e) => e.to).sort();
  assert.deepEqual(to, ['Slot/weapon1a', 'Slot/weapon2a']);
});

test('gear-slots: requiresMainhand rides on the fits_slot edge props', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Quiver', slots: ['weapon1b', 'weapon2b'], requiresMainhand: ['bow'] }] }),
  });
  assert.equal(r.errors.length, 0);
  const fits = r.edges.filter((e) => e.type === 'fits_slot');
  assert.ok(fits.length === 2 && fits.every((e) => Array.isArray(e.props?.requiresMainhand) && e.props.requiresMainhand[0] === 'bow'));
});

test('gear-slots: a class with no bases in source is a build error', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Nonexistent Class', slots: ['helmet'] }] }),
  });
  assert.ok(r.errors.some((e) => /item class 'Nonexistent Class' has no bases/.test(e)));
});

test('gear-slots: a rule referencing an unknown slot id is a build error', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Helmet', slots: ['nonexistent-slot'] }] }),
  });
  assert.ok(r.errors.some((e) => /unknown slot 'nonexistent-slot'/.test(e)));
});

test('gear-slots: requiresMainhand naming an unknown class slug is a build error', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Quiver', slots: ['weapon1b', 'weapon2b'], requiresMainhand: ['nonexistent-mainhand'] }] }),
  });
  assert.ok(r.errors.some((e) => /requiresMainhand references unknown class slug 'nonexistent-mainhand'/.test(e)));
});

test('gear-slots: a classRule with empty slots is a build error and does not suppress the coverage warning', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Helmet', slots: [] }] }),
  });
  assert.ok(r.errors.some((e) => /class 'Helmet' has no slots/.test(e)));
  assert.ok(r.warnings.some((w) => /unmapped item class 'Helmet'/.test(w)));
});

test('gear-slots: unmapped item classes produce a coverage warning', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Helmet', slots: ['helmet'] }] }),
  });
  // Two Hand Mace and Quiver are present in nodes but unmapped here.
  assert.ok(r.warnings.some((w) => /unmapped item class 'Two Hand Mace'/.test(w)));
  assert.ok(r.warnings.some((w) => /unmapped item class 'Quiver'/.test(w)));
});

// --- unique-origins & cultivated-uniques overlays (prop patches by vid) ------
// Fresh nodes per test: these handlers MUTATE the matched node's props in place.
const uNodes = () => ([
  { id: 'Unique/Atz', kind: 'unique', name: "Atziri's Contempt", slug: 'atziris-contempt', props: { vid: 'FourUniqueSpear14_' }, source: 'repoe' },
  { id: 'Unique/DupA', kind: 'unique', name: 'Dup A', slug: 'dup-a', props: { vid: 'SharedVid' }, source: 'repoe' },
  { id: 'Unique/DupB', kind: 'unique', name: 'Dup B', slug: 'dup-b', props: { vid: 'SharedVid' }, source: 'repoe' },
]);
const originsOv = (entries) => [{ name: 'unique-origins', data: { kind: 'unique-origins', entries } }];
const cultivatedOv = (entries) => [{ name: 'cultivated-uniques', data: { kind: 'cultivated-uniques', entries } }];

test('unique-origins: attaches props.origin to the node matched by vid', () => {
  const nodes = uNodes();
  const r = applyOverlays({ nodes, edges: [], overlays: originsOv([{ unique: "Atziri's Contempt", vid: 'FourUniqueSpear14_', origin: 'Vaal' }]) });
  assert.equal(r.errors.length, 0, r.errors.join('\n'));
  assert.equal(nodes[0].props.origin, 'Vaal');
});

test('unique-origins: an unknown origin value is a build error', () => {
  const nodes = uNodes();
  const r = applyOverlays({ nodes, edges: [], overlays: originsOv([{ unique: "Atziri's Contempt", vid: 'FourUniqueSpear14_', origin: 'Atlantean' }]) });
  assert.ok(r.errors.some((e) => /unknown origin 'Atlantean'/.test(e)));
  assert.equal(nodes[0].props.origin, undefined);
});

test('unique-origins: an unresolved vid is a build error', () => {
  const nodes = uNodes();
  const r = applyOverlays({ nodes, edges: [], overlays: originsOv([{ unique: 'Ghost', vid: 'NoSuchVid', origin: 'Vaal' }]) });
  assert.ok(r.errors.some((e) => /no unique node for vid 'NoSuchVid'/.test(e)));
});

test('unique-origins: an ambiguous vid (>1 node) is a build error', () => {
  const nodes = uNodes();
  const r = applyOverlays({ nodes, edges: [], overlays: originsOv([{ unique: 'Dup A', vid: 'SharedVid', origin: 'Ezomyte' }]) });
  assert.ok(r.errors.some((e) => /vid 'SharedVid' is ambiguous/.test(e)));
});

test('unique-origins: a name that disagrees with the node warns but still patches', () => {
  const nodes = uNodes();
  const r = applyOverlays({ nodes, edges: [], overlays: originsOv([{ unique: 'Stale Name', vid: 'FourUniqueSpear14_', origin: 'Vaal' }]) });
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /name mismatch for vid 'FourUniqueSpear14_'/.test(w)));
  assert.equal(nodes[0].props.origin, 'Vaal');
});

test('cultivated-uniques: resolves mod ids to texts via the injected resolver', () => {
  const nodes = uNodes();
  const resolveModTexts = (id) => ({ ModA: ['(1-2)% increased X'], ModB: ['+3 to Y'] }[id] ?? []);
  const r = applyOverlays({
    nodes, edges: [], resolveModTexts,
    overlays: cultivatedOv([{ unique: "Atziri's Contempt", vid: 'FourUniqueSpear14_', mods: ['ModA', 'ModB'] }]),
  });
  assert.equal(r.errors.length, 0, r.errors.join('\n'));
  assert.deepEqual(nodes[0].props.cultivatedMods, [
    { modId: 'ModA', texts: ['(1-2)% increased X'] },
    { modId: 'ModB', texts: ['+3 to Y'] },
  ]);
});

test('cultivated-uniques: a mod id RePoE cannot resolve is a build error', () => {
  const nodes = uNodes();
  const r = applyOverlays({
    nodes, edges: [], resolveModTexts: () => [],
    overlays: cultivatedOv([{ unique: "Atziri's Contempt", vid: 'FourUniqueSpear14_', mods: ['GoneModId'] }]),
  });
  assert.ok(r.errors.some((e) => /mod 'GoneModId'.*not resolvable/.test(e)));
});

// --- pool-uniques: overlay-created unique nodes -------------------------------
// The only handler that CREATES unique nodes. Pool-driven uniques (Loreweave &
// co) have no fixed stat block, so Path of Building can't express them and the
// source builder — which enumerates uniques FROM PoB — never emits a node.
const poolMeta = {
  FourUniqueBodyStrInt14: {
    id: 'Loreweave', name: 'Loreweave', item_class: 'Body Armour',
    inventory_width: 2, inventory_height: 3,
    visual_identity: { id: 'FourUniqueBodyStrInt14', dds_file: 'Art/Loreweave.dds' },
  },
};
const poolModIds = [
  'UniqueLoreweaveSnakepit1',
  'UniqueLoreweaveSnakepit2',
  'UniqueLoreweaveSnakepit1BigRange', // wider-range duplicate: counted, not listed
  'UniqueLoreweaveOrphan1', // stem absent from sourceUniques -> no origin
  'UniqueLoreweaveSekhemasResolveEmerald1', // explicit null -> deliberately unattributed
];
const poolBase = [
  { id: 'Base/Ringmail', kind: 'base', name: 'Ringmail', slug: 'ringmail', props: { classSlug: 'body-armour', className: 'Body Armours', itemClass: 'Body Armour' }, source: 'repoe' },
  { id: 'Unique/Snakepit', kind: 'unique', name: 'Snakepit', slug: 'snakepit', props: { vid: 'Ring1' }, source: 'repoe' },
];
const poolOverlay = (entries, sourceUniques) => [{
  name: 'pool-uniques',
  data: {
    kind: 'pool-uniques',
    entries,
    sourceUniques: sourceUniques ?? { Snakepit: 'Snakepit', SekhemasResolveEmerald: null },
  },
}];
const poolEntry = {
  unique: 'Loreweave', vid: 'FourUniqueBodyStrInt14', modPrefix: 'UniqueLoreweave',
  baseLabel: 'Any Body Armour', poolLabel: 'Woven Mods', note: ['not guaranteed'],
};
const runPool = (overlays, extra = {}) => applyOverlays({
  nodes: poolBase,
  edges: [],
  overlays,
  resolveModTexts: (id) => [`text:${id}`],
  uniqueMetaByVid: (vid) => poolMeta[vid] ?? null,
  modIdsByPrefix: (p) => poolModIds.filter((id) => id.startsWith(p)),
  flavourForVid: () => ['flavour'],
  ...extra,
});

test('pool-uniques creates a derived unique node with RePoE metadata joined by vid', () => {
  const r = runPool(poolOverlay([poolEntry]));
  assert.deepEqual(r.errors, []);
  const n = r.nodes.find((x) => x.kind === 'unique');
  assert.ok(n, 'a unique node was created');
  assert.equal(n.id, 'Unique/Loreweave');
  assert.equal(n.slug, 'loreweave');
  assert.equal(n.source, 'derived');
  assert.equal(n.via, 'manual:pool-uniques');
  assert.equal(n.props.iconDds, 'Art/Loreweave.dds', 'icon derived from RePoE, not hand-authored');
  assert.deepEqual(n.props.inventorySize, { w: 2, h: 3 });
  assert.deepEqual(n.props.flavour, ['flavour']);
  // Canonical class comes from the base nodes ("Body Armour" -> "Body Armours").
  assert.equal(n.props.className, 'Body Armours');
  assert.equal(n.props.classSlug, 'body-armour');
});

test('pool-uniques presents no guaranteed mods and keeps the honesty note', () => {
  const r = runPool(poolOverlay([poolEntry]));
  const n = r.nodes.find((x) => x.kind === 'unique');
  // base stays null so nothing downstream mistakes the label for a real base.
  assert.equal(n.props.base, null);
  assert.equal(n.props.baseLabel, 'Any Body Armour');
  assert.equal(n.props.isPool, true);
  assert.deepEqual(n.props.poolNote, ['not guaranteed'], 'the uncertainty note survives to the node');
  // A single empty variant: toUnique() indexes variants[currentIndex] for
  // implicits/explicits, and a pool unique has neither.
  assert.deepEqual(n.props.variants, [{ name: null, implicits: [], explicits: [] }]);
  assert.equal(n.props.currentIndex, 0);
});

test('pool-uniques excludes BigRange twins from the pool but counts them', () => {
  const r = runPool(poolOverlay([poolEntry]));
  const n = r.nodes.find((x) => x.kind === 'unique');
  assert.equal(n.props.poolMods.length, 4, 'the BigRange duplicate is not listed');
  assert.equal(n.props.wideRangeCount, 1);
  assert.ok(!n.props.poolMods.some((m) => m.modId.includes('BigRange')));
});

test('pool-uniques attributes pooled mods to their source unique, and only those', () => {
  const r = runPool(poolOverlay([poolEntry]));
  const n = r.nodes.find((x) => x.kind === 'unique');
  const byId = new Map(n.props.poolMods.map((m) => [m.modId, m.sourceUnique]));
  assert.equal(byId.get('UniqueLoreweaveSnakepit1'), 'Snakepit');
  assert.equal(byId.get('UniqueLoreweaveSnakepit2'), 'Snakepit');
  // A stem with no sourceUniques entry, and one mapped to an explicit null, are
  // both left unattributed rather than guessed at.
  assert.equal(byId.get('UniqueLoreweaveOrphan1'), null);
  assert.equal(byId.get('UniqueLoreweaveSekhemasResolveEmerald1'), null);
  // One pool_source edge per SOURCE UNIQUE, not per mod.
  const edges = r.edges.filter((e) => e.type === 'pool_source');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].from, 'Unique/Loreweave');
  assert.equal(edges[0].to, 'Unique/Snakepit');
  assert.equal(edges[0].source, 'derived');
  assert.equal(edges[0].via, 'manual:pool-uniques');
});

test('pool-uniques resolves origins against uniques created in the same pass', () => {
  // Loreweave weaves Grip of Kulemak, which this same overlay creates — the
  // origin edge must still resolve.
  const meta = {
    ...poolMeta,
    Ring33: { id: 'Kulemak', name: 'Grip of Kulemak', item_class: 'Ring', inventory_width: 1, inventory_height: 1, visual_identity: { id: 'Ring33', dds_file: 'a.dds' } },
  };
  const r = applyOverlays({
    nodes: poolBase,
    edges: [],
    overlays: poolOverlay(
      [poolEntry, { unique: 'Grip of Kulemak', vid: 'Ring33', modPrefix: 'UniqueLoreweaveKulemak' }],
      { Kulemak: 'Grip of Kulemak' },
    ),
    resolveModTexts: (id) => [`text:${id}`],
    uniqueMetaByVid: (vid) => meta[vid] ?? null,
    modIdsByPrefix: (p) => ['UniqueLoreweaveKulemak1', 'UniqueLoreweaveSnakepit1'].filter((id) => id.startsWith(p)),
    flavourForVid: () => null,
  });
  assert.deepEqual(r.errors, []);
  const edge = r.edges.find((e) => e.type === 'pool_source');
  assert.ok(edge, 'origin edge resolved to a node created in the same pass');
  assert.equal(edge.to, 'Unique/Kulemak');
  assert.notEqual(edge.from, edge.to, 'an item is never its own origin');
});

test('pool-uniques fails the build on an unresolvable vid, prefix, or source unique', () => {
  const bad = runPool(poolOverlay([{ ...poolEntry, vid: 'GoneAfterRescrape' }]));
  assert.ok(bad.errors.some((e) => /no RePoE uniques.json entry for vid/.test(e)), bad.errors.join('|'));

  const noMods = runPool(poolOverlay([{ ...poolEntry, modPrefix: 'UniqueNothingMatches' }]));
  assert.ok(noMods.errors.some((e) => /matches no mods/.test(e)), noMods.errors.join('|'));

  // A renamed source unique must fail loudly, never silently drop the link —
  // precedent: GGG renamed Sekhema's Resolve to Safrin's Resolve.
  const renamed = runPool(poolOverlay([poolEntry], { Snakepit: 'Snakepit Renamed' }));
  assert.ok(renamed.errors.some((e) => /resolves to no unique node/.test(e)), renamed.errors.join('|'));
});

test('pool-uniques retires itself when the source builder starts shipping the unique', () => {
  const nodes = [
    ...poolBase,
    { id: 'Unique/Loreweave', kind: 'unique', name: 'Loreweave', slug: 'loreweave', props: { vid: 'FourUniqueBodyStrInt14' }, source: 'repoe' },
  ];
  const r = applyOverlays({
    nodes,
    edges: [],
    overlays: poolOverlay([poolEntry]),
    resolveModTexts: (id) => [`text:${id}`],
    uniqueMetaByVid: (vid) => poolMeta[vid] ?? null,
    modIdsByPrefix: (p) => poolModIds.filter((id) => id.startsWith(p)),
    flavourForVid: () => null,
  });
  assert.deepEqual(r.errors, [], 'retirement warns, it does not fail');
  assert.equal(r.nodes.filter((n) => n.kind === 'unique').length, 0, 'no duplicate node emitted');
  assert.ok(r.warnings.some((w) => /retire manual:pool-uniques/.test(w)), r.warnings.join('|'));
});

// --- unique-gaps: the reconciliation guardrail --------------------------------
// The defect that hid Loreweave was silence, not a wrong value: PoB decides which
// uniques exist, and anything it lacks vanished with a green build.
const gapsOverlay = (accepted) => [{ name: 'unique-gaps', data: { kind: 'unique-gaps', accepted } }];

test('unique-gaps warns about a RePoE unique that produced no node', () => {
  const r = applyOverlays({
    nodes: poolBase,
    edges: [],
    overlays: gapsOverlay([]),
    repoeUniqueNames: () => ['Snakepit', 'Loreweave'],
  });
  assert.ok(r.warnings.some((w) => /unique gap: RePoE ships 'Loreweave'/.test(w)), r.warnings.join('|'));
  assert.deepEqual(r.reconciliation.unexpected, ['Loreweave']);
  assert.equal(r.reconciliation.built, 1);
  assert.equal(r.reconciliation.repoe, 2);
});

test('unique-gaps silences an explicitly accepted hole but still counts it', () => {
  const r = applyOverlays({
    nodes: poolBase,
    edges: [],
    overlays: gapsOverlay([{ unique: 'Megalomaniac', why: 'grants notables, not item mods' }]),
    repoeUniqueNames: () => ['Snakepit', 'Megalomaniac'],
  });
  assert.ok(!r.warnings.some((w) => /unique gap:/.test(w)), 'accepted gaps are not warned about');
  assert.deepEqual(r.reconciliation.unexpected, []);
  assert.equal(r.reconciliation.acceptedGaps, 1);
});

test('unique-gaps requires a documented reason, and retires stale entries', () => {
  const undocumented = applyOverlays({
    nodes: poolBase, edges: [], overlays: gapsOverlay([{ unique: 'Mystery' }]), repoeUniqueNames: () => ['Mystery'],
  });
  assert.ok(undocumented.errors.some((e) => /needs a 'why'/.test(e)), undocumented.errors.join('|'));

  // Now curated -> the allowlist entry must go.
  const nowBuilt = applyOverlays({
    nodes: poolBase, edges: [], overlays: gapsOverlay([{ unique: 'Snakepit', why: 'x' }]), repoeUniqueNames: () => ['Snakepit'],
  });
  assert.ok(nowBuilt.warnings.some((w) => /retire manual:unique-gaps: 'Snakepit'/.test(w)), nowBuilt.warnings.join('|'));

  // Gone from RePoE -> the allowlist entry is stale.
  const gone = applyOverlays({
    nodes: poolBase, edges: [], overlays: gapsOverlay([{ unique: 'Removed', why: 'x' }]), repoeUniqueNames: () => ['Snakepit'],
  });
  assert.ok(gone.warnings.some((w) => /stale manual:unique-gaps: 'Removed'/.test(w)), gone.warnings.join('|'));
});
