import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, renderBuild, renderImport, esc } from '../public/js/builds-render.js';
import { emptyBuild } from '../public/js/build-store.js';
import { renderEditor, renderVariantStrip } from '../public/js/editor-render.js';

const fixedBuild = (over = {}) => emptyBuild({ now: () => 1750000000000, uuid: () => 'b-1', ...over });

test('parseRoute maps hashes to views', () => {
  assert.deepEqual(parseRoute(''), { view: 'list' });
  assert.deepEqual(parseRoute('#'), { view: 'list' });
  assert.deepEqual(parseRoute('#/b/b-1'), { view: 'build', id: 'b-1' });
  assert.deepEqual(parseRoute('#/import/1abc'), { view: 'import', code: '1abc' });
  assert.deepEqual(parseRoute('#/nonsense'), { view: 'list' });
});

// The standalone list view is gone (2026-07-22): '#' lands in the editor and
// the rail build-switcher popover took over listing — see editorRender tests.

test('renderBuild: resolves refs, humanizes slots, shows setups', () => {
  const b = fixedBuild({
    name: 'Spark',
    class: 'sorceress',
    ascendancy: 'stormweaver',
    gear: { 'body-armour': { item: { kind: 'unique', slug: 'the-three-dragons' }, wishlist: [] } },
    unassigned: [{ kind: 'gem', slug: 'spark' }],
    skills: [{ gem: { slug: 'spark' }, level: 20, supports: [{ slug: 'pierce' }] }],
    tree: { code: 'v7code', notablePriority: [111, 222] },
  });
  const resolve = (ref) => ({ name: `N:${ref.slug}`, iconUrl: null, url: `/x/${ref.slug}` });
  const html = renderBuild(b, resolve);
  assert.match(html, /Body Armour/);
  assert.match(html, /N:the-three-dragons/);
  assert.match(html, /N:spark/);
  assert.match(html, /N:pierce/);
  assert.match(html, /2 prioritized/);
});

test('renderBuild: unresolved refs fall back to the slug', () => {
  const b = fixedBuild({ unassigned: [{ kind: 'gem', slug: 'mystery-gem' }] });
  assert.match(renderBuild(b, () => null), /mystery-gem/);
});

test('renderBuild: lists chosen mods under an equipped item', () => {
  const pools = { families: { life: { name: 'to maximum Life', origin: 'standard', tiers: [{ id: 'life1', gen: 'prefix', text: '+(40-49) to maximum Life' }] } }, bases: {}, uniques: {} };
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' }, mods: [{ affix: 'life', tier: 'life1' }], corrupted: null };
  const html = renderBuild(b, () => ({ name: 'Iron Hat' }), pools);
  assert.ok(html.includes('+(40-49) to maximum Life'));
});

test('renderImport states', () => {
  assert.match(renderImport({ status: 'loading' }, () => null), /Decoding/i);
  assert.match(renderImport({ status: 'error', message: 'nope' }, () => null), /nope/);
  const ready = renderImport({ status: 'ready', build: fixedBuild({ name: 'Shared' }) }, () => null);
  assert.match(ready, /Shared/);
  assert.match(ready, /data-import-save/);
});

test('esc escapes html metacharacters', () => {
  assert.equal(esc(`<a b="c">&'`), '&lt;a b=&quot;c&quot;&gt;&amp;&#39;');
});

test('renderBuild: shows description, never a skill level', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x',
    description: 'Lightning bows.',
    skills: [{ gem: { slug: 'spark' }, level: 12, supports: [] }] });
  const html = renderBuild(b, () => null);
  assert.match(html, /builds-desc/);
  assert.ok(html.includes('Lightning bows.'));
  assert.ok(!/Lv 12/.test(html), 'levels are not surfaced');
});

// ---- Phase 8: variant strip ----------------------------------------------

const stripCtx = (over = {}) => ({
  planner: { classes: [], slots: [], items: {}, gems: {} },
  resolveRef: () => null, mode: 'edit', ...over,
});
const vb = (id, name) => ({ ...emptyBuild({ now: () => 1, uuid: () => id }), name });

test('renderVariantStrip renders nothing for a standalone build in edit mode', () => {
  const b = vb('p', 'Solo');
  const html = renderVariantStrip(b, stripCtx({ group: { parent: b, variants: [] }, currentId: 'p' }));
  assert.match(html, /data-variant-add/, 'a standalone build still offers "add variant"');
  assert.ok(!html.includes('data-variant-tab'), 'no tabs without variants');
});

test('renderVariantStrip renders nothing at all in read-only mode without variants', () => {
  const b = vb('p', 'Solo');
  const html = renderVariantStrip(b, stripCtx({ mode: 'import', group: { parent: b, variants: [] }, currentId: 'p' }));
  assert.equal(html.trim(), '');
});

test('renderVariantStrip renders parent + ordered variant tabs, current marked', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [
    { label: 'Lv 1-30', build: vb('v1', 'Lv 1-30') },
    { label: 'Lv 30-60', build: vb('v2', 'Lv 30-60') },
  ] };
  const html = renderVariantStrip(group.variants[0].build, stripCtx({ group, currentId: 'v1' }));
  assert.match(html, /data-variant-tab="p"/);
  assert.match(html, /data-variant-tab="v1"/);
  assert.match(html, /data-variant-tab="v2"/);
  assert.ok(html.indexOf('data-variant-tab="v1"') < html.indexOf('data-variant-tab="v2"'), 'list order is preserved');
  assert.match(html, /data-variant-tab="v1"[^>]*class="[^"]*is-current/,
    'the current variant is marked');
  assert.match(html, /Lv 1-30/);
});

test('renderVariantStrip escapes labels', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [{ label: '<script>x</script>', build: vb('v1', 'x') }] };
  const html = renderVariantStrip(parent, stripCtx({ group, currentId: 'p' }));
  assert.ok(!html.includes('<script>'), 'label is escaped');
  assert.match(html, /&lt;script&gt;/);
});

test('renderVariantStrip read-only hides add/rename/unlink controls', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [{ label: 'Lv 1-30', build: vb('v1', 'Lv 1-30') }] };
  const html = renderVariantStrip(parent, stripCtx({ mode: 'import', group, currentId: 'p' }));
  assert.match(html, /data-variant-tab="v1"/, 'tabs still switch in a shared view');
  assert.ok(!html.includes('data-variant-add'));
  assert.ok(!html.includes('data-variant-unlink'));
  assert.ok(!html.includes('data-variant-rename'));
});

test('renderVariantStrip swaps the current tab for an input while renaming', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [{ label: 'Lv 1-30', build: vb('v1', 'Lv 1-30') }] };
  const html = renderVariantStrip(group.variants[0].build,
    stripCtx({ group, currentId: 'v1', variantRenaming: 'v1' }));
  assert.match(html, /data-variant-label-input/);
  assert.match(html, /value="Lv 1-30"/);
});

test('renderEditor includes the variant strip', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [{ label: 'Lv 1-30', build: vb('v1', 'Lv 1-30') }] };
  const html = renderEditor(parent, stripCtx({ group, currentId: 'p', builds: [parent] }));
  assert.match(html, /data-variant-tab="v1"/);
});

// ---- Phase 8: shared group view -----------------------------------------

test('renderVariantStrip in import mode marks the active decoded snapshot', () => {
  const parent = vb('shared-parent', 'Guide');
  const group = { parent, variants: [
    { label: 'Lv 1-30', build: vb('shared-v0', 'Early') },
    { label: 'Lv 30-60', build: vb('shared-v1', 'Mid') },
  ] };
  const html = renderVariantStrip(group.variants[1].build,
    stripCtx({ mode: 'import', group, currentId: 'shared-v1' }));
  assert.match(html, /data-variant-tab="shared-v1"[^>]*class="[^"]*is-current/);
  assert.ok(!html.includes('data-variant-add'), 'a visitor cannot add variants to your group');
});
