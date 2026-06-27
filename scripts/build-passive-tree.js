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
import { getDataDir } from './graph/source.js';
import { ddsUrl } from '../src/data/images.js';
import { renderGameText } from '../src/data/keywords.js';
import { hasDefinition } from '../src/data/keywordDefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEN_DIR = path.join(__dirname, '..', 'public', 'generated');
const OUT = path.join(GEN_DIR, 'passive-tree.json');
const CARDS_OUT = path.join(GEN_DIR, 'passive-cards.json');
const ATLAS_SRC = path.join(getDataDir(), 'ggg-poe2', 'atlas');
const ATLAS_OUT = path.join(GEN_DIR, 'passive-atlas');

// Served locations of the self-hosted GGG sprite atlases.
const ATLAS_IMG = '/static/img/passive-atlas';   // <name>.webp (fetch-ggg-tree)
const ATLAS_MAP = '/static/generated/passive-atlas'; // <name>.json (copied below)

// GGG icon paths are .png; the same art is mirrored as webp via ggpk (.dds key).
const iconWebp = (icon) => (icon ? ddsUrl(icon.replace(/\.png$/i, '.dds')) : null);

export function buildArtifact() {
  const { nodes, edges, classStarts, classes, ascStarts, ascByClass, ascArt, extent } = parseGggTree();

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
    meta: {
      classStarts,
      classArt,
      ascStarts,
      ascByClass,
      ascendancyArt,
      extent,
      pointBudget: 122,
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
    '{% from "macros/passive.njk" import passiveDetail %}{{ passiveDetail(vm) }}',
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
  const { nodes } = parseGggTree();
  const cards = {};
  for (const n of nodes) {
    if (n.hidden) continue;
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
    };
    cards[n.h] = tmpl.render({ vm });
  }
  return cards;
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
  fs.writeFileSync(OUT, JSON.stringify(art));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${art.nodes.length} nodes, ${art.edges.length} edges -> ${OUT} (${kb} KB)`);

  const maps = copyAtlasMaps();
  console.log(`build-passive-tree: ${maps} atlas maps -> ${ATLAS_OUT}`);

  const cards = buildCards();
  fs.writeFileSync(CARDS_OUT, JSON.stringify(cards));
  const ckb = (fs.statSync(CARDS_OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${Object.keys(cards).length} cards -> ${CARDS_OUT} (${ckb} KB)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
