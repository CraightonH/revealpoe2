import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gemNodes } from '../../scripts/graph/gems.js';
import { loadJson } from '../../scripts/graph/loader.js';
import { REPOE } from '../../scripts/graph/source.js';

// Mirror of the parse rule under test.
function parseTagToken(raw) {
  if (!raw) return null;
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
  const pipe = inner.indexOf('|');
  return { token: raw, display: pipe === -1 ? inner : inner.slice(pipe + 1) };
}

test('gem nodes carry resolved tagTokens (display tags only, source order)', () => {
  const { nodes } = gemNodes();
  const map = loadJson(`${REPOE}/gem_tags.json`);

  for (const n of nodes) {
    const expected = (n.props.tags ?? [])
      .map((id) => parseTagToken(map[id]))
      .filter(Boolean)
      .map((p) => ({ token: p.token, display: p.display }));
    assert.deepEqual(n.props.tagTokens, expected, `tagTokens mismatch on ${n.id}`);
  }
});

test('known tag ids resolve to the expected tokens', () => {
  const { nodes } = gemNodes();
  // find a gem that has the "area" tag to assert the [AoESkill|AoE] shape
  const withArea = nodes.find((n) => (n.props.tags ?? []).includes('area'));
  if (withArea) {
    const aoe = withArea.props.tagTokens.find((t) => t.token === '[AoESkill|AoE]');
    assert.ok(aoe, 'expected [AoESkill|AoE] token on an area gem');
    assert.equal(aoe.display, 'AoE');
  }
});
