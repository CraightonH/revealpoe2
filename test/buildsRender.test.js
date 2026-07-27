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

test('a standalone build already shows itself as Variant 1', () => {
  // Regression (2026-07-26): the root used to be hidden until a variant existed,
  // so it popped into the strip out of nowhere on the first add — and that first
  // addition claimed the name "Variant 1" while the root was really the first.
  const b = vb('p', 'Solo');
  const html = renderVariantStrip(b, stripCtx({ group: { parent: b, variants: [] }, currentId: 'p' }));
  assert.match(html, /data-variant-tab="p"/, 'the root is always a tab');
  assert.match(html, />Variant 1</, 'labelled Variant 1 by default');
  assert.match(html, /data-variant-add/, 'and still offers "add variant"');
  assert.ok(!html.includes('data-variant-delete'), 'the root is not deletable from the strip');
  assert.match(html, /data-variant-rename="p"/, 'but its label IS renamable');
});

test('a renamed root label replaces the Variant 1 default', () => {
  const b = { ...vb('p', 'Stormweaver CoC'), label: 'Leveling' };
  const html = renderVariantStrip(b, stripCtx({ group: { parent: b, variants: [] }, currentId: 'p' }));
  assert.match(html, />Leveling</);
  assert.ok(!html.includes('>Variant 1<'));
  assert.ok(!html.includes('Stormweaver CoC'), 'the strip shows the LABEL, never the title');
});

test('the root keeps its Variant 1 tab once variants exist', () => {
  const parent = vb('p', 'Stormweaver CoC');
  const group = { parent, variants: [
    { label: 'Variant 2', buildId: 'v1', build: vb('v1', 'Stormweaver CoC') },
  ] };
  const html = renderVariantStrip(parent, stripCtx({ group, currentId: 'p' }));
  assert.ok(html.indexOf('>Variant 1<') < html.indexOf('>Variant 2<'), 'root first, in order');
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
  assert.ok(!html.includes('data-variant-delete'));
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

// (Removed 2026-07-26: the switcher no longer lists variants at all, so there is
// no shared-title ambiguity left to qualify — see 'lists only root builds'.)

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

test('the X on the active variant tab is a DELETE affordance, not a detach', () => {
  // Regression: it used to only detach, and because the editor stayed on the
  // orphaned build (whose own group is itself, with no variants) the whole group
  // appeared to vanish. The label/hook must read as deletion.
  const parent = vb('p', 'Stormweaver CoC');
  const child = vb('v1', 'Stormweaver CoC');
  const group = { parent, variants: [{ label: 'Leveling', build: child }] };
  const html = renderVariantStrip(child, stripCtx({ group, currentId: 'v1' }));
  assert.match(html, /data-variant-delete="v1"/, 'the hook is a delete');
  assert.match(html, /aria-label="Delete this variant"/);
  assert.ok(!html.includes('Detach'), 'no lingering detach wording');
});

test('the parent tab never offers a delete-variant control', () => {
  const parent = vb('p', 'Stormweaver CoC');
  const group = { parent, variants: [{ label: 'Leveling', build: vb('v1', 'x') }] };
  const html = renderVariantStrip(parent, stripCtx({ group, currentId: 'p' }));
  assert.ok(!html.includes('data-variant-delete'),
    'the parent is deleted from the header, not the strip');
});

test('the switcher lists only root builds — variants stay behind their parent', () => {
  const parent = { ...vb('p', 'Stormweaver CoC'), variants: [
    { label: 'Early mapping', buildId: 'v1' }, { label: 'Endgame', buildId: 'v2' }] };
  const v1 = vb('v1', 'Stormweaver CoC');
  const v2 = vb('v2', 'Stormweaver CoC');
  const solo = vb('s', 'Some Other Build');
  const html = renderEditor(parent, stripCtx({
    builds: [parent, v1, v2, solo], currentId: 'p', switcherOpen: true,
    group: { parent, variants: [{ label: 'Early mapping', buildId: 'v1', build: v1 },
                                { label: 'Endgame', buildId: 'v2', build: v2 }] },
  }));
  const rows = html.split('<li>').filter((r) => r.includes('build-switcher__row'));
  assert.equal(rows.length, 2, 'only the root and the standalone build are listed');
  assert.ok(rows.some((r) => r.includes('href="#/b/p"')), 'root is selectable');
  assert.ok(rows.some((r) => r.includes('href="#/b/s"')), 'standalone is selectable');
  assert.ok(!rows.some((r) => r.includes('href="#/b/v1"')), 'variants are NOT selectable here');
  assert.ok(!rows.some((r) => r.includes('href="#/b/v2"')));
  assert.match(html, /2 variants/, 'the root advertises how many it holds');
});

test('viewing a variant highlights its parent row in the switcher', () => {
  const parent = { ...vb('p', 'Stormweaver CoC'), variants: [{ label: 'Endgame', buildId: 'v1' }] };
  const v1 = vb('v1', 'Stormweaver CoC');
  const html = renderEditor(v1, stripCtx({
    builds: [parent, v1], currentId: 'v1', switcherOpen: true,
    group: { parent, variants: [{ label: 'Endgame', buildId: 'v1', build: v1 }] },
  }));
  const rows = html.split('<li>').filter((r) => r.includes('build-switcher__row'));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /is-current/, 'the group you are inside is marked current');
});

test('an orphaned variant becomes selectable again', () => {
  // Deleting a parent orphans its variants; with nobody referencing them they are
  // roots, so they must reappear in the switcher rather than being unreachable.
  const orphan = vb('v1', 'Stormweaver CoC');
  const html = renderEditor(orphan, stripCtx({
    builds: [orphan], currentId: 'v1', switcherOpen: true,
    group: { parent: orphan, variants: [] },
  }));
  assert.match(html, /href="#\/b\/v1"/);
});

// ---- passive-granted setup rows (2026-07-26) -----------------------------

const withTree = (hash) => {
  // A build whose tree code allocates one ascendancy notable.
  const b = vb('p', 'T');
  b.tree = { code: TREE_CODE_FOR(hash), notablePriority: [] };
  return b;
};
let TREE_CODE_FOR;
test('setup: build a real one-node ascendancy code', async () => {
  const { synthesizeState, encode } = await import('../public/js/passive-code.js');
  TREE_CODE_FOR = (h) => encode(synthesizeState({
    allocated: [h], ascByte: 1, ascOf: () => 'X', isAttr: () => false, attrOf: () => 'str',
  }));
  assert.equal(typeof TREE_CODE_FOR(1739), 'string');
});

test('an allocated skill-granting passive produces a setup row', async () => {
  const { grantedRows } = await import('../public/js/editor-render.js');
  const planner = { granted: {}, grantedByPassive: { 1739: { name: 'Hollow Form Technique', skills: ['hollow-form'] } } };
  const rows = grantedRows(withTree(1739), planner);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].skill, 'hollow-form');
  assert.equal(rows[0].passive, 'Hollow Form Technique');
  assert.equal(rows[0].item, undefined, 'a passive row carries no item');
  assert.match(rows[0].key, /^passive:1739:hollow-form$/);
});

test('no row when that passive is not allocated', async () => {
  const { grantedRows } = await import('../public/js/editor-render.js');
  const planner = { granted: {}, grantedByPassive: { 1739: { name: 'X', skills: ['hollow-form'] } } };
  assert.deepEqual(grantedRows(withTree(9999), planner), []);
  const noTree = vb('p', 'T');
  assert.deepEqual(grantedRows(noTree, planner), []);
});

test('support choices survive unallocating and re-allocating the passive', async () => {
  const { grantedRows } = await import('../public/js/editor-render.js');
  const planner = { granted: {}, grantedByPassive: { 1739: { name: 'X', skills: ['hollow-form'] } } };
  const b = withTree(1739);
  // The key is derived from the HASH, not from row order, so a stored choice
  // reattaches after the passive is dropped and taken again.
  b.grantedSupports = { 'passive:1739:hollow-form': [{ slug: 'martial-tempo' }] };
  assert.deepEqual(grantedRows(b, planner)[0].supports, [{ slug: 'martial-tempo' }]);
  const dropped = { ...b, tree: { code: null, notablePriority: [] } };
  assert.deepEqual(grantedRows(dropped, planner), [], 'row gone while unallocated');
  assert.deepEqual(grantedRows(b, planner)[0].supports, [{ slug: 'martial-tempo' }], 'and restored on re-allocate');
});

test('a garbage tree code cannot break the skills section', async () => {
  const { grantedRows } = await import('../public/js/editor-render.js');
  const b = vb('p', 'T');
  b.tree = { code: 'not-a-code', notablePriority: [] };
  assert.deepEqual(grantedRows(b, { granted: {}, grantedByPassive: { 1: { name: 'X', skills: ['y'] } } }), []);
});
