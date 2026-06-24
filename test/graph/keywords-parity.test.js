import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordNodes } from '../../scripts/graph/keywords.js';
import { deriveKeywordPhrases } from '../../src/data/keywordPhrases.js';
import { loadJson } from '../../scripts/graph/loader.js';
import { REPOE } from '../../scripts/graph/source.js';

test('PARITY: keyword node definitions match keywords.json defined entries', () => {
  const keywords = loadJson(`${REPOE}/keywords.json`);
  const { nodes } = keywordNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const definedIds = Object.entries(keywords)
    .filter(([, e]) => e && typeof e.definition === 'string' && e.definition.trim())
    .map(([id]) => id);

  assert.equal(byId.size, definedIds.length, 'node count matches defined-keyword count');
  for (const id of definedIds) {
    const n = byId.get(id);
    assert.ok(n, `missing node for ${id}`);
    assert.equal(n.props.definition, keywords[id].definition);
    assert.equal(n.name, (keywords[id].term && keywords[id].term.trim()) || id);
  }
});

test('PARITY: flattened node phrases equal the old deriveKeywordPhrases output', () => {
  const { nodes } = keywordNodes();
  const fromNodes = nodes
    .flatMap((n) => n.props.phrases.map((p) => `${p}\t${n.id}`))
    .sort();
  const fromOld = deriveKeywordPhrases()
    .map(([p, id]) => `${p}\t${id}`)
    .sort();
  assert.deepEqual(fromNodes, fromOld);
});
