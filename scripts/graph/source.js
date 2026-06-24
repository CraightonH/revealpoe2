// scripts/graph/source.js — build-time source-path resolution. Builder-only.
import 'dotenv/config';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export function expandHome(p) {
  if (p && p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

export function getDataDir() {
  const raw = process.env.POE2DATADIR;
  if (!raw) throw new Error('POE2DATADIR is not set (check .env)');
  const dir = path.join(expandHome(raw), 'data');
  if (!fs.existsSync(dir)) {
    throw new Error(`POE2DATADIR data dir not found: ${dir}`);
  }
  return dir;
}

export const REPOE = 'repoe-poe2';
