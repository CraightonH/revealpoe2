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

test('gear-slots: unmapped item classes produce a coverage warning', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Helmet', slots: ['helmet'] }] }),
  });
  // Two Hand Mace and Quiver are present in nodes but unmapped here.
  assert.ok(r.warnings.some((w) => /unmapped item class 'Two Hand Mace'/.test(w)));
  assert.ok(r.warnings.some((w) => /unmapped item class 'Quiver'/.test(w)));
});
