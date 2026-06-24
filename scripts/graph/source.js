// scripts/graph/source.js — build-time source-path resolution. Builder-only.
import 'dotenv/config';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function expandHome(p) {
  if (p && p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

// Scraped source data lives in-repo under data/source/ (gitignored). The legacy
// POE2DATADIR env var still works as an override (points at a dir containing a
// `data/` subdir) for anyone keeping the data in a sibling location.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function getDataDir() {
  const inRepo = path.join(REPO_ROOT, 'data', 'source');
  // Legacy sibling-dir override — honored only if it actually has data, so a
  // stale POE2DATADIR left in the environment can't shadow the in-repo source.
  const override = process.env.POE2DATADIR;
  if (override) {
    const dir = path.join(expandHome(override), 'data');
    if (fs.existsSync(path.join(dir, REPOE))) return dir;
  }
  if (!fs.existsSync(inRepo)) {
    throw new Error(`source data dir not found: ${inRepo} (run scripts/scrape.py)`);
  }
  return inRepo;
}

export const REPOE = 'repoe-poe2';
