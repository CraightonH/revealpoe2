import { loadJson } from './loader.js';
import { ddsUrl } from './images.js';
import { renderGameText, stripGameText } from './keywords.js';
import { hasDefinition } from './keywordDefs.js';
import { REPOE } from '../config.js';

let _passives = null;
let _statMap = null;
let _ascData = null;

function buildStatMap() {
  if (_statMap) return;
  const passive = loadJson(`${REPOE}/stat_translations/passive_skill_stat_descriptions.json`);
  const general = loadJson(`${REPOE}/stat_translations/stat_descriptions.json`);
  _statMap = new Map();
  // load general first so passive-specific entries override
  for (const entry of general) {
    const eng = entry.English?.[0];
    if (!eng) continue;
    for (const id of entry.ids ?? []) {
      _statMap.set(id, eng);
    }
  }
  for (const entry of passive) {
    const eng = entry.English?.[0];
    if (!eng) continue;
    for (const id of entry.ids ?? []) {
      _statMap.set(id, eng);
    }
  }
}

function rawString(entry, val) {
  return entry.format?.[0] === 'ignore'
    ? entry.string
    : entry.string.replace('{0}', val);
}

function translateStats(stats) {
  buildStatMap();
  const lines = [];
  for (const [id, val] of Object.entries(stats ?? {})) {
    const entry = _statMap.get(id);
    if (!entry) continue;
    for (const line of rawString(entry, val).split('\n')) {
      if (line.trim()) lines.push(renderGameText(line, hasDefinition));
    }
  }
  return lines;
}

function translateStatsRaw(stats) {
  buildStatMap();
  const parts = [];
  for (const [id, val] of Object.entries(stats ?? {})) {
    const entry = _statMap.get(id);
    if (!entry) continue;
    for (const line of rawString(entry, val).split('\n')) {
      if (line.trim()) parts.push(stripGameText(line));
    }
  }
  return parts.join(' ');
}

function buildPassiveIndex() {
  if (_passives) return;
  const tree = loadJson(`${REPOE}/passive_skill_trees/Default.json`);
  _passives = tree.passives;
}

// Per-ascendancy accent colors, keyed by ascendancy id. Chosen to evoke each
// ascendancy's in-game theme; drives the header accent and card background tint
// on the ascendancy pages. Fallback used for any future/unknown id.
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

function buildAscIndex() {
  if (_ascData) return;
  const raw = loadJson(`${REPOE}/ascendancies.json`);
  _ascData = new Map();
  for (const [id, v] of Object.entries(raw)) {
    if (v.disabled || (v.name && v.name.includes('[DNT'))) continue;
    _ascData.set(id, {
      id,
      name: v.name,
      charClass: v.character[1],
      color: ASC_COLORS[id] || ASC_COLOR_DEFAULT,
    });
  }
}

function nodeRecord(p) {
  return {
    id: p.id,
    name: p.name,
    iconUrl: ddsUrl(p.icon),
    statLines: translateStats(p.stats),
    statRaw: translateStatsRaw(p.stats),
    flavourText: p.flavour_text || '',
    reminderText: Array.isArray(p.reminder_text) ? p.reminder_text : [],
    ascendancy: p.ascendancy ?? null,
    kind: p.is_keystone ? 'keystone' : 'notable',
  };
}

export function listKeystones() {
  buildPassiveIndex();
  return Object.values(_passives)
    .filter((p) => p.is_keystone)
    .map(nodeRecord)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getKeystone(id) {
  buildPassiveIndex();
  const p = Object.values(_passives).find((n) => n.is_keystone && n.id === id);
  return p ? nodeRecord(p) : null;
}

export function listNotables() {
  buildPassiveIndex();
  return Object.values(_passives)
    .filter((p) => p.is_notable && !p.ascendancy)
    .map(nodeRecord)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getNotable(id) {
  buildPassiveIndex();
  const p = Object.values(_passives).find((n) => n.is_notable && !n.ascendancy && n.id === id);
  return p ? nodeRecord(p) : null;
}

// Generic lookup for any passive node (keystone or notable, including
// ascendancy notables, which getNotable/getKeystone deliberately exclude).
// For ascendancy nodes it also attaches the ascendancy's display name, base
// class, and colorway so the detail page / hover card can theme to match.
export function getPassiveNode(id) {
  buildPassiveIndex();
  const p = Object.values(_passives).find((n) => (n.is_notable || n.is_keystone) && n.id === id);
  if (!p) return null;
  const rec = nodeRecord(p);
  if (rec.ascendancy) {
    buildAscIndex();
    const a = _ascData.get(rec.ascendancy);
    if (a) {
      rec.ascendancyName = a.name;
      rec.charClass = a.charClass;
      rec.ascColor = a.color;
    }
  }
  return rec;
}

export function listAscendancies() {
  buildAscIndex();
  buildPassiveIndex();
  return Array.from(_ascData.values())
    .map((a) => ({
      ...a,
      notables: Object.values(_passives)
        .filter((p) => p.is_notable && p.ascendancy === a.id)
        .map(nodeRecord)
        .sort((x, y) => x.name.localeCompare(y.name)),
    }))
    .sort((a, b) => a.charClass.localeCompare(b.charClass) || a.name.localeCompare(b.name));
}

export function getAscendancy(ascId) {
  buildAscIndex();
  buildPassiveIndex();
  const a = _ascData.get(ascId);
  if (!a) return null;
  return {
    ...a,
    notables: Object.values(_passives)
      .filter((p) => p.is_notable && p.ascendancy === ascId)
      .map(nodeRecord)
      .sort((x, y) => x.name.localeCompare(y.name)),
  };
}
