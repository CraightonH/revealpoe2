import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, renderBuild, renderImport, esc } from '../public/js/builds-render.js';
import { emptyBuild } from '../public/js/build-store.js';
import { renderEditor, renderVariantStrip, MAX_DESCRIPTION, MAX_NOTES } from '../public/js/editor-render.js';
import { MAX_BUILDS, LIMITS } from '../public/js/build-store.js';

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

test('the tab shows the variant LABEL while the head shows the build NAME', () => {
  // The whole point of the 2026-07-26 decoupling: one group, one shared title,
  // labels carrying the phase.
  const parent = vb('p', 'Stormweaver CoC');
  const child = vb('v1', 'Stormweaver CoC');
  const group = { parent, variants: [{ label: 'Leveling', build: child }] };
  const html = renderEditor(child, stripCtx({ group, currentId: 'v1', builds: [parent, child] }));

  assert.match(html, /data-variant-tab="v1"[^>]*>Leveling</, 'the tab renders the label');
  assert.match(html, /data-build-rename="v1"[^>]*>Stormweaver CoC/,
    'the dossier head renders the build name, not the label');
});

test('a variant tab label and its build name stay independent strings', () => {
  const parent = vb('p', 'Stormweaver CoC');
  const child = vb('v1', 'Totally Different Title');
  const group = { parent, variants: [{ label: 'Endgame', build: child }] };
  const html = renderVariantStrip(child, stripCtx({ group, currentId: 'v1' }));
  assert.match(html, />Endgame</, 'label on the tab');
  assert.ok(!html.includes('Totally Different Title'),
    'the strip must not leak the build name into the tab');
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

test('the switcher qualifies a variant row with its label, standalone rows plain', () => {
  const parent = { ...vb('p', 'Stormweaver CoC'), variants: [{ label: 'Leveling', buildId: 'v1' }] };
  const child = vb('v1', 'Stormweaver CoC');
  const solo = vb('s', 'Some Other Build');
  const html = renderEditor(parent, stripCtx({
    group: { parent, variants: [{ label: 'Leveling', build: child }] },
    currentId: 'p', builds: [parent, child, solo], switcherOpen: true,
  }));
  // Isolate each switcher row rather than slicing by character offset.
  const rows = html.split('<li>').filter((r) => r.includes('build-switcher__row'));
  const row = (name) => rows.find((r) => r.includes(name));

  // The child row carries the label so two identically-titled rows differ.
  assert.match(row('Stormweaver CoC') && rows.filter((r) => r.includes('Stormweaver CoC')).join(''),
    /build-switcher__variant"> · Leveling</);
  // The standalone build gets no qualifier.
  assert.ok(!row('Some Other Build').includes('build-switcher__variant'),
    'standalone rows are not qualified');
  // Exactly one row is qualified — the parent must not be.
  assert.equal(rows.filter((r) => r.includes('build-switcher__variant')).length, 1,
    'only the variant row is qualified; the parent is identified by its name');
});

test('the unbounded text fields carry a maxlength', () => {
  const b = vb('p', 'Capped');
  const html = renderEditor(b, stripCtx({ builds: [b], currentId: 'p' }));
  assert.match(html, new RegExp(`data-description[^>]*maxlength="${MAX_DESCRIPTION}"`),
    'description is capped');
  assert.match(html, new RegExp(`data-notes[^>]*maxlength="${MAX_NOTES}"`), 'notes is capped');
});

test('at the build ceiling the create affordances are disabled', () => {
  const many = Array.from({ length: MAX_BUILDS }, (_, i) => vb(`b${i}`, `b${i}`));
  const html = renderEditor(many[0], stripCtx({
    builds: many, currentId: 'b0', switcherOpen: true,
    group: { parent: many[0], variants: [] },
  }));
  assert.match(html, /data-builds-new[^>]*disabled/, 'new build disabled');
  assert.match(html, /data-variant-add[^>]*disabled/, 'add variant disabled');
  assert.match(html, /data-build-duplicate="b0"[^>]*disabled/, 'duplicate disabled');
  assert.match(html, new RegExp(`${MAX_BUILDS} / ${MAX_BUILDS} builds`), 'the count is shown');
});

test('below the ceiling nothing is disabled', () => {
  const few = [vb('a', 'A'), vb('b', 'B')];
  const html = renderEditor(few[0], stripCtx({
    builds: few, currentId: 'a', switcherOpen: true, group: { parent: few[0], variants: [] },
  }));
  assert.ok(!/data-builds-new[^>]*disabled/.test(html));
  assert.ok(!/data-variant-add[^>]*disabled/.test(html));
  assert.ok(!/data-build-duplicate="a"[^>]*disabled/.test(html));
});

test('a trimmed shared build says so in the preview', () => {
  const b = vb('p', 'Shared');
  const html = renderEditor(b, stripCtx({
    mode: 'import', builds: [b], currentId: 'p', group: { parent: b, variants: [] },
    trimmed: ['notes shortened to 10000 characters', 'skill setups reduced to 24'],
  }));
  assert.match(html, /dossier-banner--warn/);
  assert.match(html, /trimmed to fit/);
  assert.match(html, /notes shortened to 10000 characters/);
});

test('an untrimmed shared build shows no warning banner', () => {
  const b = vb('p', 'Shared');
  const html = renderEditor(b, stripCtx({
    mode: 'import', builds: [b], currentId: 'p', group: { parent: b, variants: [] }, trimmed: [],
  }));
  assert.ok(!html.includes('dossier-banner--warn'));
});

test('the add-skill-setup button locks at the setup ceiling', () => {
  const full = vb('p', 'Full');
  full.skills = Array.from({ length: LIMITS.setups }, (_, i) => ({ gem: { slug: `g${i}` }, level: null, supports: [] }));
  const html = renderEditor(full, stripCtx({ builds: [full], currentId: 'p' }));
  assert.match(html, /data-setup-add[^>]*disabled/);
  const room = vb('q', 'Room');
  room.skills = [{ gem: { slug: 'spark' }, level: null, supports: [] }];
  assert.ok(!/data-setup-add[^>]*disabled/.test(renderEditor(room, stripCtx({ builds: [room], currentId: 'q' }))));
});
