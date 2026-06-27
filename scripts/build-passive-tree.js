// scripts/build-passive-tree.js — emit passive-tree.json render artifact
// Reads parseTree() (canonical parser) and maps to a compact render shape.
// Output: public/generated/passive-tree.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import { parseTree } from './graph/passiveSource.js';
import { loadJson } from './graph/loader.js';
import { REPOE } from './graph/source.js';
import { ddsUrl } from '../src/data/images.js';
import { getPassiveNode } from '../src/data/passiveTree.js';
import { renderGameText } from '../src/data/keywords.js';
import { hasDefinition } from '../src/data/keywordDefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'generated', 'passive-tree.json');
const CARDS_OUT = path.join(__dirname, '..', 'public', 'generated', 'passive-cards.json');

// Native artwork diameters in px (== world units; nodes/orbits share the source
// coordinate space, so drawing a frame at its native size reproduces the in-game
// proportions — the "artwork ratios" of TODO 8). Measured from the webp assets.
const FRAME_PX = {
  small: 102, notable: 151, keystone: 217, jewel: 151,
  ascStart: 90, ascNotable: 206, ascSmall: 159,
};
const GROUP_BG_PX = { small: 359, medium: 465, large: 739 };

// Map a source art frame object {unallocated,allocatable,allocated} to renderer
// URLs keyed by state: u(nallocated) / a(llocatable) / (allocated→)x.
const frameStates = (f) => ({
  u: ddsUrl(f.unallocated),
  a: ddsUrl(f.allocatable),
  x: ddsUrl(f.allocated),
});

// Class name -> base-class illustration URL (the big central art per class).
// The illustration lives in the ascendancy's `character` metadata array
// (Art/2DArt/BaseClassIllustrations/<Class>BaseIllustration.dds); one per class.
function classArtMap() {
  const asc = loadJson(`${REPOE}/ascendancies.json`);
  const out = {};
  for (const v of Object.values(asc)) {
    if (v.disabled || (v.name && v.name.includes('[DNT'))) continue;
    if (!Array.isArray(v.character)) continue;
    const cls = v.character[1];
    if (!cls || out[cls]) continue;
    const illo = v.character.find(
      (s) => typeof s === 'string' && s.includes('BaseClassIllustrations'),
    );
    if (illo) out[cls] = ddsUrl(illo);
  }
  return out;
}

export function buildArtifact() {
  const { nodes, edges, meta } = parseTree();
  const a = meta.art;      // main-tree (Character) art
  const aa = meta.ascArt;  // representative ascendancy art (shared frames)

  // Per-node-kind frame art. Ascendancy kinds use the ascendancy frame variants.
  const art = {
    small:      frameStates(a.passive_frame),
    notable:    frameStates(a.notable_frame),
    keystone:   frameStates(a.keystone_frame),
    jewel:      frameStates(a.jewel_frame),
    ascStart:   frameStates(aa.ascendancystart_frame),
    ascNotable: frameStates(aa.notable_frame),
    ascSmall:   frameStates(aa.passive_frame),
  };

  // Orbit-ring backgrounds. `large` art is a half-circle (drawn mirrored into a
  // full ring by the renderer); `half` flags that.
  const groupBg = {
    small:  { u: ddsUrl(a.group_bg_small_normal),  px: GROUP_BG_PX.small },
    medium: { u: ddsUrl(a.group_bg_medium_normal), px: GROUP_BG_PX.medium },
    large:  { u: ddsUrl(a.group_bg_large_normal),  px: GROUP_BG_PX.large, half: true },
  };

  return {
    nodes: nodes.map((n) => ({
      h: n.h,
      x: Math.round(n.x),
      y: Math.round(n.y),
      k: n.k,
      name: n.name,
      stats: n.stats,
      icon: n.iconDds ? ddsUrl(n.iconDds) : null,
      asc: n.asc,
      ws: n.ws,
    })),
    edges,
    groups: meta.groups, // [{x,y,r}] orbit-ring backgrounds
    meta: {
      classStarts: meta.classStarts,
      ascStarts: meta.ascStarts,
      liveAscendancies: meta.liveAscendancies,
      pointBudget: 122, // character passive point cap; refine if source provides it
      art,
      frame: FRAME_PX,
      groupBg,
      classArt: classArtMap(),
      // Central class-frame ring. GGG's group-background spritesheet (self-hosted
      // via fetch-images EXTERNAL_CHROME); the `startNode:MainCircle` sprite is
      // the right 2000×2000 cell. Atlas is at 0.5 scale, so native (world-unit)
      // diameter = 2000/0.5 = 4000 — drawn centered at the tree origin. The class
      // illustration is 3000 native, i.e. fills exactly 0.75 of the frame.
      classFrame: {
        url: '/static/img/passive-atlas/group-background.webp',
        sx: 2000, sy: 0, sw: 2000, sh: 2000,
        native: 4000,
      },
    },
  };
}

// Type-line label for nodes that aren't keystones/notables (which the macro
// labels itself). Keeps the in-game-style header subtitle accurate per kind.
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

// Pre-render a passiveDetail card (ornate banner + keyword-linkified stats) for
// EVERY tree node, keyed by node hash. Keystones/notables/ascendancy notables
// reuse the rich graph view model (flavour text, granted skills, reminder text);
// all other kinds (small, jewel, ascStart, ascSmall) get a minimal view model
// built straight from the canonical parse. The canvas tooltip shows these via
// the shared Tippy harness, so the look matches the rest of the site exactly.
export function buildCards() {
  const env = nunjucks.configure(path.join(__dirname, '..', 'views'), { autoescape: true });
  const tmpl = nunjucks.compile(
    '{% from "macros/passive.njk" import passiveDetail %}{{ passiveDetail(vm) }}',
    env,
  );
  const { nodes } = parseTree();
  const cards = {};
  for (const n of nodes) {
    const rich = getPassiveNode(n.slug); // keystone/notable/ascNotable; null otherwise
    const vm = rich || {
      name: n.name,
      kind: n.k,
      typeLabel: typeLabelForKind(n.k),
      iconUrl: n.iconDds ? ddsUrl(n.iconDds) : null,
      statLines: n.stats.map((line) => renderGameText(line, hasDefinition)),
      reminderText: [],
      flavourText: null,
    };
    cards[n.h] = tmpl.render({ vm });
  }
  return cards;
}

function main() {
  const art = buildArtifact();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(art));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${art.nodes.length} nodes, ${art.edges.length} edges -> ${OUT} (${kb} KB)`);

  const cards = buildCards();
  fs.writeFileSync(CARDS_OUT, JSON.stringify(cards));
  const ckb = (fs.statSync(CARDS_OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${Object.keys(cards).length} cards -> ${CARDS_OUT} (${ckb} KB)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
