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

function buildAscIndex() {
  if (_ascData) return;
  const raw = loadJson(`${REPOE}/ascendancies.json`);
  _ascData = new Map();
  for (const [id, v] of Object.entries(raw)) {
    if (v.disabled || (v.name && v.name.includes('[DNT'))) continue;
    _ascData.set(id, { id, name: v.name, charClass: v.character[1] });
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
