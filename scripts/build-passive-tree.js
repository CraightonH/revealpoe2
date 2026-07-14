// scripts/build-passive-tree.js — emit the passive-tree render artifact + cards.
//
// Geometry/structure/art come from GGG's OWN tree dataset (scripts/graph/gggTree.js
// over data/source/ggg-poe2/, fetched by scripts/fetch-ggg-tree.js) so the render
// matches the official tree exactly — absolute positions, precomputed arc geometry,
// and the web sprite atlases. RePoE remains the source for the rest of the wiki.
//
// Outputs:
//   public/generated/passive-tree.json     — nodes/edges/meta the canvas reads
//   public/generated/passive-cards.json     — pre-rendered hover cards by node hash
//   public/generated/passive-atlas/*.json    — sprite atlas frame maps (served copy)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import { parseGggTree } from './graph/gggTree.js';
import { getDataDir, REPOE } from './graph/source.js';
import { buildEmotionIndex, resolveRecipe } from './graph/emotions.js';
import { ddsUrl } from '../src/data/images.js';
import { renderGameText, stripGameText, escapeHtml } from '../src/data/keywords.js';
import { hasDefinition } from '../src/data/keywordDefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEN_DIR = path.join(__dirname, '..', 'public', 'generated');
const OUT = path.join(GEN_DIR, 'passive-tree.json');
const CARDS_OUT = path.join(GEN_DIR, 'passive-cards.json');
const SEARCH_OUT = path.join(GEN_DIR, 'passive-search.json');
const STATS_OUT = path.join(GEN_DIR, 'passive-stats.json');
const EMOTIONS_OUT = path.join(GEN_DIR, 'instill-emotions.json');
const ATLAS_SRC = path.join(getDataDir(), 'ggg-poe2', 'atlas');
const ATLAS_OUT = path.join(GEN_DIR, 'passive-atlas');

// Served locations of the self-hosted GGG sprite atlases.
const ATLAS_IMG = '/static/img/passive-atlas';   // <name>.webp (fetch-ggg-tree)
const ATLAS_MAP = '/static/generated/passive-atlas'; // <name>.json (copied below)

// GGG icon paths are .png; the same art is mirrored as webp via ggpk (.dds key).
const iconWebp = (icon) => (icon ? ddsUrl(icon.replace(/\.png$/i, '.dds')) : null);

// Distilled Emotion index, loaded once from base_items.json (the "instill"
// recipes reference these currency items by de-spaced name).
let _emotionIndex;
function emotionIndex() {
  if (!_emotionIndex) {
    const p = path.join(getDataDir(), REPOE, 'base_items.json');
    _emotionIndex = buildEmotionIndex(JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  return _emotionIndex;
}

// Dominant base attribute of a class → the default attribute for path-allocated
// generic "+5 to any Attribute" nodes. Argmax of base str/dex/int, ties str>dex>int.
function primaryAttr(str = 0, dex = 0, int = 0) {
  if (str >= dex && str >= int) return 'str';
  if (dex >= int) return 'dex';
  return 'int';
}

export function buildArtifact() {
  const { nodes, edges, masteries, classStarts, classes, ascStarts, ascByClass, ascArt, extent } = parseGggTree();

  // Per-class central illustration: served atlas + frame key + placement offset.
  const classArt = {};
  for (const [name, c] of Object.entries(classes)) {
    if (!c.art) continue;
    const slug = name.toLowerCase();
    classArt[name] = {
      atlas: `${ATLAS_IMG}/background-${slug}.webp`,
      map: `${ATLAS_MAP}/background-${slug}.json`,
      frame: `class${name}:Class0`,
      offsetX: c.offsetX,
      offsetY: c.offsetY,
      start: c.start,
      // Dominant base attribute (argmax of base str/dex/int), the default for
      // path-allocated generic "+5 to any Attribute" nodes. Derived, not a
      // hand table, so it tracks GGG's class stats across patches. Ties → str>dex>int.
      attr: primaryAttr(c.str, c.dex, c.int),
    };
  }

  // Per-ascendancy central illustration. Unlike class backgrounds these have no
  // GGG web atlas, so the art is self-hosted through the ggpk .dds→webp pipeline
  // (same as node icons) — its .dds path enters the fetch-images set via the
  // `img` field below. `class` lets the renderer pick the owning class on import.
  // (GGG's offsetX/Y anchor the art to the cluster's native group centre, which
  // doesn't map to the origin-centred draw, so they're intentionally dropped.)
  const ascendancyArt = {};
  for (const [id, a] of Object.entries(ascArt)) {
    if (!a.art) continue;
    ascendancyArt[id] = { img: iconWebp(a.art), class: a.class };
  }

  return {
    nodes: nodes.map((n) => ({
      h: n.h, x: n.x, y: n.y, k: n.k, name: n.name,
      icon: n.icon, iconKind: n.iconKind,
      asc: n.asc, ws: n.ws,
      ...(n.lock ? { lock: n.lock } : {}),
      ...(n.attr ? { attr: 1 } : {}),
      ...(n.hidden ? { hidden: 1 } : {}),
    })),
    edges,
    // Mastery background patterns (TODO #6): non-selectable; a lit pattern is
    // drawn behind the cluster when any `t` (trigger) node is allocated, a dim one
    // otherwise. `e` = GGG effect-image path → mastery-effect atlas key.
    masteries: masteries.map((m) => ({
      h: m.h, x: m.x, y: m.y, e: m.effect, t: m.triggers,
      ...(m.lock ? { lock: m.lock } : {}),
    })),
    meta: {
      classStarts,
      classArt,
      ascStarts,
      ascByClass,
      ascendancyArt,
      extent,
      pointBudget: 122,
      ascendancyBudget: 8,
      weaponSetBudget: 25,
      atlas: {
        img: ATLAS_IMG,
        map: ATLAS_MAP,
        // central class-frame ring lives in group-background as startNode:MainCircle
        classFrame: { map: `${ATLAS_MAP}/group-background.json`, img: `${ATLAS_IMG}/group-background.webp`, frame: 'startNode:MainCircle' },
      },
    },
  };
}

function typeLabelForKind(k) {
  switch (k) {
    case 'keystone':   return 'Keystone';
    case 'notable':    return 'Notable Passive';
    case 'ascNotable': return 'Notable Passive';
    case 'ascSmall':   return 'Passive';
    case 'ascStart':   return 'Ascendancy';
    case 'jewel':      return 'Jewel Socket';
    default:           return 'Passive';
  }
}

// One hover card per node, keyed by hash. Stats come straight from GGG (already
// English, in our [tag|text] keyword format) and are keyword-linkified through
// the shared renderer so the look matches the rest of the site.
export function buildCards() {
  const env = nunjucks.configure(path.join(__dirname, '..', 'views'), { autoescape: true });
  const tmpl = nunjucks.compile(
    // showIcon=false: on the tree the node art is already on the canvas, so the
    // in-card icon (shown on tooltips elsewhere) would be redundant here.
    '{% from "macros/passive.njk" import passiveDetail %}{{ passiveDetail(vm, false) }}',
    env,
  );
  // Generic-attribute nodes ("+5 to any Attribute") render as a 3-way choice
  // (Str/Int/Dex) instead of the generic line; the renderer highlights the
  // chosen one. data-attr keys it; renderGameText keeps the +5 number styling.
  const ATTR_OPTS = [
    { key: 'str', line: renderGameText('+5 to Strength', hasDefinition) },
    { key: 'int', line: renderGameText('+5 to Intelligence', hasDefinition) },
    { key: 'dex', line: renderGameText('+5 to Dexterity', hasDefinition) },
  ];
  const emo = emotionIndex();
  const { nodes } = parseGggTree();
  const cards = {};
  for (const n of nodes) {
    if (n.hidden) continue;
    // Instill recipe → 3 ordered emotion boxes (duplicates preserved). An
    // unknown token throws (fails the build) rather than dropping the relation.
    const instill = n.recipe
      ? resolveRecipe(emo, n.recipe).map((e) => ({ key: e.key, name: e.name, iconUrl: e.iconUrl }))
      : null;
    const vm = {
      name: n.name,
      kind: n.k,
      typeLabel: typeLabelForKind(n.k),
      iconUrl: iconWebp(n.icon),
      statLines: n.stats.flatMap((s) => s.split('\n')).filter(Boolean)
        .map((line) => renderGameText(line, hasDefinition)),
      reminderText: [],
      flavourText: null,
      attrOptions: n.attr ? ATTR_OPTS : null,
      instill,
    };
    cards[n.h] = tmpl.render({ vm });
  }
  return cards;
}

// Per-emotion detail cards (nested tooltip, keyword-glossary style) keyed by
// slug, plus the served webp URLs so fetch-images can self-host the icons.
// Only emotions actually referenced by a recipe are emitted.
export function buildEmotions() {
  const emo = emotionIndex();
  const { nodes } = parseGggTree();
  const used = new Set();
  for (const n of nodes) for (const t of n.recipe || []) used.add(t);

  const cards = {};
  const icons = [];
  for (const e of emo.byToken.values()) {
    if (!used.has(e.name.replace(/\s+/g, ''))) continue;
    const effectHtml = e.description
      ? renderGameText(e.description, hasDefinition).replace(/\r?\n/g, '<br>')
      : null;
    const directionsHtml = e.directions
      ? escapeHtml(e.directions).replace(/\r?\n/g, '<br>')
      : null;
    cards[e.key] = {
      name: e.name,
      iconUrl: e.iconUrl,
      effectHtml,
      directionsHtml,
      stackSize: e.stackSize,
    };
    if (e.iconUrl) icons.push(e.iconUrl);
  }
  return { cards, icons };
}

// Lightweight search index: hash -> lowercased searchable text (node name plus
// its stat lines as plain text, glossary tokens stripped). Drives the in-canvas
// search bar (substring match highlights nodes, dims the rest). Keyed only for
// visible nodes — hidden anchors aren't searchable.
export function buildSearch() {
  const { nodes } = parseGggTree();
  const out = {};
  for (const n of nodes) {
    if (n.hidden) continue;
    const text = [n.name, ...n.stats.map(stripGameText)]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    out[n.h] = text;
  }
  return out;
}

// Raw stat lines per node, keyed by hash — the input to the client-side stat
// aggregation panel (public/js/passive-stats-agg.js). Unlike buildSearch (which
// strips markup for matching) and buildCards (which renders HTML), this keeps
// the GGG lines verbatim in [tag|text] keyword format so the client can both
// templatize/sum them and strip them for display. Multi-line stat strings are
// split so each line is an independent summable unit. Visible nodes only —
// hidden anchors carry no stats.
export function buildStats() {
  const { nodes } = parseGggTree();
  const out = {};
  for (const n of nodes) {
    if (n.hidden) continue;
    const lines = n.stats.flatMap((s) => s.split('\n')).filter(Boolean);
    if (lines.length) out[n.h] = lines;
  }
  return out;
}

function copyAtlasMaps() {
  fs.mkdirSync(ATLAS_OUT, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(ATLAS_SRC)) {
    if (!f.endsWith('.json')) continue;
    fs.copyFileSync(path.join(ATLAS_SRC, f), path.join(ATLAS_OUT, f));
    n++;
  }
  return n;
}

function main() {
  const art = buildArtifact();
  fs.mkdirSync(GEN_DIR, { recursive: true });

  // Distilled Emotion detail cards + the icon URLs they reference. Stamp the
  // icons into the tree artifact's meta so fetch-images self-hosts them (they're
  // currency items, absent from build/graph.json's browsable set).
  const emotions = buildEmotions();
  art.meta.instillIcons = emotions.icons;

  fs.writeFileSync(OUT, JSON.stringify(art));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${art.nodes.length} nodes, ${art.edges.length} edges -> ${OUT} (${kb} KB)`);

  fs.writeFileSync(EMOTIONS_OUT, JSON.stringify(emotions.cards));
  console.log(`build-passive-tree: ${Object.keys(emotions.cards).length} instill emotions -> ${EMOTIONS_OUT}`);

  const maps = copyAtlasMaps();
  console.log(`build-passive-tree: ${maps} atlas maps -> ${ATLAS_OUT}`);

  const cards = buildCards();
  fs.writeFileSync(CARDS_OUT, JSON.stringify(cards));
  const ckb = (fs.statSync(CARDS_OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${Object.keys(cards).length} cards -> ${CARDS_OUT} (${ckb} KB)`);

  const search = buildSearch();
  fs.writeFileSync(SEARCH_OUT, JSON.stringify(search));
  const skb = (fs.statSync(SEARCH_OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${Object.keys(search).length} search entries -> ${SEARCH_OUT} (${skb} KB)`);

  const stats = buildStats();
  fs.writeFileSync(STATS_OUT, JSON.stringify(stats));
  const stkb = (fs.statSync(STATS_OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${Object.keys(stats).length} stat entries -> ${STATS_OUT} (${stkb} KB)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
