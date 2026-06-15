import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../config.js';

const cache = new Map();

// relPath is relative to the data dir, e.g. "repoe-poe2/skill_gems.json"
export function loadJson(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const full = path.join(getDataDir(), relPath);
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  cache.set(relPath, parsed);
  return parsed;
}

export function clearCache() {
  cache.clear();
}

// Returns the filenames (not full paths) in a data subdirectory.
export function listDataDir(relDir) {
  const full = path.join(getDataDir(), relDir);
  return fs.readdirSync(full);
}
