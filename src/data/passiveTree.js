import { ddsUrl } from './images.js';
import { renderGameText, stripGameText } from './keywords.js';
import { hasDefinition } from './keywordDefs.js';
import { getGemRefByKey } from './gems.js';
import { nodesByKind, nodeBySlug, edgesFrom } from './graph.js';

// Presentation adapter over the build-time graph (build/graph.json). Passive
// identity, resolved stat strings, flavour/reminder text, and the grants /
// in_ascendancy relationships live in the graph (scripts/graph/passives.js);
// this module reads `passive` + `ascendancy` nodes/edges and owns all rendering.
// It performs NO reads of $POE2DATADIR. Stat strings arrive pre-resolved (stat-id
// -> English with values substituted); keyword linkification stays here.

// Per-ascendancy accent colors, keyed by ascendancy id. Chosen to evoke each
// ascendancy's in-game theme; drives the header accent and card background tint
// on the ascendancy pages. Presentation styling (graph rule #8) — stays app-side.
// Fallback used for any future/unknown id.
const ASC_COLORS = {
  Druid1: '#4fa3a3', // Oracle — divinatory teal
  Druid2: '#8a9a5b', // Shaman — mossy green
  Huntress1: '#c9a24b', // Amazon — bronze
  Huntress2: '#6fd1e0', // Spirit Walker — ethereal cyan
  Huntress3: '#b23b54', // Ritualist — ritual crimson
  Mercenary1: '#5b8fb9', // Tactician — steel blue
  Mercenary2: '#9aa3ad', // Witchhunter — gunmetal
  Mercenary3: '#2bb6a8', // Gemling Legionnaire — gem teal
  Monk1: '#d77a3a', // Martial Artist — ember orange
  Monk2: '#8ab4ff', // Invoker — lightning blue
  Monk3: '#9b59c4', // Acolyte of Chayula — chaos violet
  Ranger1: '#5aa84f', // Deadeye — forest green
  Ranger3: '#84c145', // Pathfinder — toxic green
  Sorceress1: '#d9c64a', // Stormweaver — storm gold
  Sorceress2: '#5fc2c9', // Chronomancer — time teal
  Sorceress3: '#d05ba8', // Disciple of Varashta — exotic magenta
  Warrior1: '#b79a6b', // Titan — stone bronze
  Warrior2: '#c0563f', // Warbringer — war ochre
  Warrior3: '#d96b2c', // Smith of Kitava — forge orange
  Witch1: '#d4582b', // Infernalist — infernal orange
  Witch2: '#b03048', // Blood Mage — blood red
  Witch3: '#7fae6f', // Lich — necrotic green
  Witch3b: '#6a4f9c', // Abyssal Lich — abyssal purple
};
const ASC_COLOR_DEFAULT = '#9a8fd6';

// Reconstruct the legacy flat record from a passive graph node: stat lines
// rendered to HTML, plain statRaw for search, identity/icon/flavour, and the
// granted skill resolved from the `grants` edge (gem ref, or null).
function nodeRecord(node) {
  const p = node.props;
  const grant = edgesFrom(node.id, 'grants')[0];
  return {
    id: node.slug,
    name: node.name,
    iconUrl: ddsUrl(p.iconDds),
    statLines: p.statLines.map((line) => renderGameText(line, hasDefinition)),
    statRaw: p.statLines.map((line) => stripGameText(line)).join(' '),
    flavourText: p.flavourText,
    reminderText: p.reminderText,
    ascendancy: p.ascendancy,
    kind: p.kind,
    grantedSkill: grant ? getGemRefByKey(grant.to) : null,
  };
}

export function listKeystones() {
  return nodesByKind('passive')
    .filter((n) => n.props.kind === 'keystone')
    .map(nodeRecord)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getKeystone(id) {
  const n = nodeBySlug('passive', id);
  return n && n.props.kind === 'keystone' ? nodeRecord(n) : null;
}

export function listNotables() {
  return nodesByKind('passive')
    .filter((n) => n.props.kind === 'notable' && !n.props.ascendancy)
    .map(nodeRecord)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getNotable(id) {
  const n = nodeBySlug('passive', id);
  return n && n.props.kind === 'notable' && !n.props.ascendancy ? nodeRecord(n) : null;
}

// Generic lookup for any passive node (keystone or notable, including
// ascendancy notables, which getNotable/getKeystone deliberately exclude).
// For ascendancy nodes it also attaches the ascendancy's display name, base
// class, and colorway so the detail page / hover card can theme to match.
export function getPassiveNode(id) {
  const n = nodeBySlug('passive', id);
  if (!n) return null;
  const rec = nodeRecord(n);
  if (rec.ascendancy) {
    const a = nodeBySlug('ascendancy', rec.ascendancy);
    if (a) {
      rec.ascendancyName = a.name;
      rec.charClass = a.props.charClass;
      rec.ascColor = ASC_COLORS[rec.ascendancy] || ASC_COLOR_DEFAULT;
    }
  }
  return rec;
}

