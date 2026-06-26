// scripts/build-passive-tree.js — emit passive-tree.json render artifact
// Reads parseTree() (canonical parser) and maps to a compact render shape.
// Output: public/generated/passive-tree.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import { parseTree } from './graph/passiveSource.js';
import { ddsUrl } from '../src/data/images.js';
import { getPassiveNode } from '../src/data/passiveTree.js';
import { renderGameText } from '../src/data/keywords.js';
import { hasDefinition } from '../src/data/keywordDefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'generated', 'passive-tree.json');
const CARDS_OUT = path.join(__dirname, '..', 'public', 'generated', 'passive-cards.json');

export function buildArtifact() {
  const { nodes, edges, meta } = parseTree();
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
    meta: {
      classStarts: meta.classStarts,
      ascStarts: meta.ascStarts,
      liveAscendancies: meta.liveAscendancies,
      pointBudget: 122, // character passive point cap; refine if source provides it
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
