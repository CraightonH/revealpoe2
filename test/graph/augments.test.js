import { test } from 'node:test';
import assert from 'node:assert/strict';
import { augmentNodes, augmentEdges, CATEGORY_CLASSES } from '../../scripts/graph/augments.js';
import { classNodes } from '../../scripts/graph/bases.js';
import { loadJson } from '../../scripts/graph/loader.js';
import { REPOE } from '../../scripts/graph/source.js';

// Expected family node counts (Rune 221 source entries collapse to 174 identities;
// every other family is one node per entry). See docs augments-graph-design spec.
const EXPECTED_BY_FAMILY = {
  AbyssalEye: 4,
  CongealedMist: 1,
  Idol: 35,
  Rune: 174,
  SoulCore: 34,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_BY_FAMILY).reduce((a, b) => a + b, 0); // 248

function countByFamily(nodes) {
  const out = {};
  for (const n of nodes) out[n.props.family] = (out[n.props.family] ?? 0) + 1;
  return out;
}

test('augmentNodes: total node count and per-family breakdown', () => {
  const { nodes } = augmentNodes();
  assert.equal(nodes.length, EXPECTED_TOTAL, '248 augment identities total');
  assert.ok(nodes.every((n) => n.kind === 'augment'), 'every node is kind augment');
  assert.deepEqual(countByFamily(nodes), EXPECTED_BY_FAMILY, 'per-family node counts');
});

test('augmentNodes: Rune tiers collapse into one identity, ordered low→high with scaling values', () => {
  const { nodes } = augmentNodes();
  const vision = nodes.filter((n) => n.name === 'Vision Rune');
  assert.equal(vision.length, 1, 'Vision Rune is a single collapsed node');
  const v = vision[0];
  // Node id is the highest tier's metadata key (stable, source-derived).
  assert.equal(v.id, 'Metadata/Items/SoulCores/RuneAccuracyPerfect');
  assert.equal(v.props.family, 'Rune');

  // tiers[] sorted lesser < normal < greater < perfect.
  assert.deepEqual(
    v.props.tiers.map((t) => t.tier),
    ['lesser', 'normal', 'greater', 'perfect'],
    'four tiers in low→high rank order',
  );

  // Martial Weapon accuracy line scales +60 (lesser) → +150 (perfect).
  const martialText = (tier) => tier.categories
    .find((c) => c.category === 'Martial Weapon').statText.join(' ');
  assert.match(martialText(v.props.tiers[0]), /\+60 /, 'lesser +60 accuracy');
  assert.match(martialText(v.props.tiers[3]), /\+150 /, 'perfect +150 accuracy');

  // Top-tier fields reflect the highest (perfect) member.
  assert.equal(v.props.requiredLevel, 50, 'top tier requiredLevel 50');
  assert.equal(v.props.tiers[v.props.tiers.length - 1].tier, 'perfect', 'top tier is perfect');
});

test('augmentNodes: a non-rune family entry is a single-tier node', () => {
  const { nodes } = augmentNodes();
  // Every non-rune node collapses to exactly one tier.
  for (const n of nodes) {
    if (n.props.family !== 'Rune') {
      assert.equal(n.props.tiers.length, 1, `${n.name} (${n.props.family}) is single-tier`);
      assert.equal(n.props.tiers[0].tier, 'base', `${n.name} tier id is 'base'`);
    }
  }
  // Sanity: at least one representative from a non-rune family exists.
  const idol = nodes.find((n) => n.props.family === 'Idol');
  assert.ok(idol && idol.props.tiers.length === 1, 'Idol family present and single-tier');
});

test('augmentNodes: limit is markup-stripped for a Limit-1 augment; a null-limit augment exists', () => {
  const { nodes } = augmentNodes();
  const amanamu = nodes.find((n) => n.name === "Amanamu's Gaze");
  assert.ok(amanamu, "Amanamu's Gaze node present");
  assert.equal(amanamu.props.family, 'AbyssalEye');
  // Source limit is "1 [Ancient|Ancient Augment]" — markup stripped, no brackets/pipes.
  assert.equal(amanamu.props.limit, '1 Ancient Augment', 'limit markup stripped');
  assert.doesNotMatch(amanamu.props.limit, /[[\]|]/, 'no residual markup characters');
  assert.equal(amanamu.props.tiers.length, 1, 'single tier');

  assert.ok(
    nodes.some((n) => n.props.limit === null),
    'at least one augment has null limit',
  );
});

test('augmentNodes: category stat text preserves keyword markup (resolver must not strip it)', () => {
  const { nodes } = augmentNodes();
  const vision = nodes.find((n) => n.name === 'Vision Rune');
  const allStatText = vision.props.tiers
    .flatMap((t) => t.categories.flatMap((c) => c.statText))
    .join(' ');
  // The app applies renderGameText, so the [Ref|Display] markup must survive intact.
  assert.match(allStatText, /\[Accuracy\|Accuracy\]/, 'keyword markup preserved in tier statText');
  // Top-level categories mirror the top tier and must also keep markup.
  const topStatText = vision.props.categories.flatMap((c) => c.statText).join(' ');
  assert.match(topStatText, /\[Accuracy\|Accuracy\]/, 'keyword markup preserved in top categories');
});

test('augmentEdges: every sockets_into edge resolves to a live Class node; derived + via stamped', () => {
  const { records } = augmentNodes();
  const cNodes = classNodes();
  const nodeIds = new Set(cNodes.map((n) => n.id));

  const edges = augmentEdges(records, nodeIds);
  assert.equal(edges.length, 1304, '1304 sockets_into edges');
  for (const e of edges) {
    assert.equal(e.type, 'sockets_into', 'edge type');
    assert.equal(e.source, 'derived', 'edge source is derived');
    assert.equal(e.via, 'augment-category-map', 'edge carries via pointer');
    assert.ok(e.to.startsWith('Class/'), `edge.to is a Class node id (${e.to})`);
    assert.ok(nodeIds.has(e.to), `edge.to ${e.to} resolves to a live Class node`);
  }
});

test('CATEGORY_CLASSES: covers every category key present in augments.json (coverage guardrail)', () => {
  const augments = loadJson(`${REPOE}/augments.json`);
  const categories = new Set();
  for (const a of Object.values(augments)) {
    for (const key of Object.keys(a.categories ?? {})) categories.add(key);
  }
  assert.ok(categories.size > 0, 'source has category keys');
  const unmapped = [...categories].filter((c) => !(c in CATEGORY_CLASSES));
  assert.deepEqual(unmapped, [], 'every source category key is mapped in CATEGORY_CLASSES');
});

test('augmentEdges: throws on an unmapped category (never a silent drop)', () => {
  const cNodes = classNodes();
  const nodeIds = new Set(cNodes.map((n) => n.id));
  const synthetic = [{ id: 'x', categories: ['NoSuchCategory'] }];
  assert.throws(
    () => augmentEdges(synthetic, nodeIds),
    /unmapped category/,
    'unmapped category fails the build',
  );
});

test('augmentEdges: throws when a mapped class has no Class node (referential integrity)', () => {
  // A mapped category with an empty nodeIds Set: the class name resolves to a
  // Class/* id that does not exist, so the build must fail rather than drop.
  const mappedCategory = Object.keys(CATEGORY_CLASSES)[0];
  const synthetic = [{ id: 'x', categories: [mappedCategory] }];
  assert.throws(
    () => augmentEdges(synthetic, new Set()),
    /no Class node/,
    'missing Class node fails the build',
  );
});
