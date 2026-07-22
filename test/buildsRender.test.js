import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, renderBuild, renderImport, esc } from '../public/js/builds-render.js';
import { emptyBuild } from '../public/js/build-store.js';

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
