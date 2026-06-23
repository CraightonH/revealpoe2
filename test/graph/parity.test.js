// TEMPORARY parity harness — deleted in Task 6 after baseItems.js reads the
// artifact (the comparison becomes circular). While baseItems.js still derives
// bases from source independently, this proves the builder reproduces it exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNodes } from '../../scripts/graph/bases.js';
import { listItemClasses, getItemClass } from '../../src/data/baseItems.js';
import { ddsUrl } from '../../src/data/images.js';
import { getGemRefByKey } from '../../src/data/gems.js';

// Every current app base record, keyed by metadataKey.
function appBasesByKey() {
  const map = new Map();
  for (const group of listItemClasses()) {
    for (const c of group.classes) {
      for (const b of getItemClass(c.classSlug).bases) map.set(b.metadataKey, b);
    }
  }
  return map;
}

test('base node set matches the current app base records', () => {
  const { nodes } = baseNodes();
  const app = appBasesByKey();
  const nodeKeys = new Set(nodes.map((n) => n.id));
  assert.equal(nodes.length, app.size, 'same base count');
  for (const k of app.keys()) assert.ok(nodeKeys.has(k), `graph missing base ${k}`);
});

test('base node props match the current app fields field-for-field', () => {
  const { nodes } = baseNodes();
  const app = appBasesByKey();
  for (const n of nodes) {
    const b = app.get(n.id);
    if (!b) continue;
    const p = n.props;
    assert.equal(n.name, b.name, `name ${n.id}`);
    assert.equal(n.slug, b.slug, `slug ${n.id}`);
    assert.equal(p.itemClass, b.itemClass, `itemClass ${n.id}`);
    assert.equal(p.className, b.className, `className ${n.id}`);
    assert.equal(p.classSlug, b.classSlug, `classSlug ${n.id}`);
    assert.equal(p.dropLevel, b.dropLevel, `dropLevel ${n.id}`);
    assert.deepEqual(p.inventorySize, b.inventorySize, `inventorySize ${n.id}`);
    assert.deepEqual(p.tags, b.tags, `tags ${n.id}`);
    assert.equal(p.attr, b.attr, `attr ${n.id}`);
    assert.equal(ddsUrl(p.iconDds), b.iconUrl, `iconUrl ${n.id}`);
    assert.deepEqual(p.implicitIds, b.implicitIds, `implicitIds ${n.id}`);
    assert.deepEqual(p.rawProperties, b.rawProperties, `rawProperties ${n.id}`);
    // node.properties is computeProperties output without the app's labelHtml.
    assert.deepEqual(
      p.properties,
      b.properties.map(({ labelHtml, ...rest }) => rest),
      `properties ${n.id}`,
    );
    // skills_granted resolves through the (already graph-backed) gem ref helper.
    const refs = (p.skillsGranted ?? []).map(getGemRefByKey).filter(Boolean);
    assert.deepEqual(refs, b.grantedSkills, `grantedSkills ${n.id}`);
  }
});
