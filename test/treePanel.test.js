import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treePanelsHtml } from '../public/js/tree-panel.js';

test('treePanelsHtml: exposes every scoped data-hook, no id collisions', () => {
  const html = treePanelsHtml();
  for (const hook of [
    'data-tree-points', 'data-tree-class', 'data-tree-asc', 'data-tree-search',
    'data-tree-reset', 'data-tree-copy', 'data-tree-fullscreen',
    'data-tree-panel', 'data-tree-panel-toggle',
    'data-tree-stats-panel', 'data-tree-stats-toggle', 'data-tree-stats-points',
    'data-tree-stats-list', 'data-ws-set', 'data-ws-count',
  ]) assert.ok(html.includes(hook), `missing ${hook}`);
  // No id="tree-*" — two embeds on one page must not collide.
  assert.ok(!/\bid="tree/.test(html), 'panel markup must not use tree-* ids');
});

test('treePanelsHtml: preserves the CSS class contract', () => {
  const html = treePanelsHtml();
  for (const cls of [
    'tree-panel', 'tree-panel-body', 'tree-panel-points', 'tree-panel-toggle',
    'tree-stats-panel', 'tree-stats-list', 'tree-ws-sets', 'tree-ws-btn', 'tree-ws-count',
    'passive-tree-select', 'passive-tree-input', 'passive-tree-btn',
    'tree-panel-field', 'tree-panel-label', 'tree-panel-actions', 'tree-fullscreen-btn',
  ]) assert.ok(html.includes(cls), `missing class ${cls}`);
});

test('treePanelsHtml: deterministic', () => {
  assert.equal(treePanelsHtml(), treePanelsHtml());
});
