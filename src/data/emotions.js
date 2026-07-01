// Runtime adapter for the Distilled Emotion detail cards (the nested "instill"
// tooltips). Reads only the prebuilt artifact — never data/source/ — matching
// the graph architecture. Built by scripts/build-passive-tree.js buildEmotions().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACT = path.join(ROOT, 'public', 'generated', 'instill-emotions.json');

let _emotions;
function emotions() {
  if (!_emotions) _emotions = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  return _emotions;
}

// Detail view-model for one emotion, keyed by slug. Null → 404.
export function getEmotion(key) {
  return emotions()[key] || null;
}
