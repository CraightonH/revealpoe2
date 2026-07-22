import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGear, rankDocs, initials } from '../public/js/editor-render.js';
import { emptyBuild } from '../public/js/build-store.js';

const PLANNER = {
  slots: [
    { id: 'weapon1a', name: 'Main Hand (Set I)', group: 'weaponset1', accepts: 'weapon', order: 1 },
    { id: 'weapon1b', name: 'Off Hand (Set I)', group: 'weaponset1', accepts: 'offhand', order: 2 },
    { id: 'weapon2a', name: 'Main Hand (Set II)', group: 'weaponset2', accepts: 'weapon', order: 3 },
    { id: 'weapon2b', name: 'Off Hand (Set II)', group: 'weaponset2', accepts: 'offhand', order: 4 },
    { id: 'helmet', name: 'Helmet', group: null, accepts: 'helmet', order: 5 },
  ],
  items: {
    'big-maul': { slots: ['weapon1a', 'weapon2a'], twoHanded: true, class: 'two-hand-maces' },
    'iron-hat': { slots: ['helmet'], twoHanded: false, class: 'helmets' },
    buckler: { slots: ['weapon1b', 'weapon2b'], twoHanded: false, class: 'shields' },
  },
  gems: {}, granted: {}, recommends: {},
};
const fixed = (over = {}) => emptyBuild({ now: () => 1, uuid: () => 'b1', ...over });
const resolve = (ref) => ({ name: `N:${ref.slug}`, iconUrl: null, url: `/x/${ref.slug}` });
const ctx = { planner: PLANNER, resolveRef: resolve, weaponSet: 1 };

test('renderGear: wells for active weapon set + slotless slots, hooks present', () => {
  const html = renderGear(fixed(), ctx);
  for (const id of ['weapon1a', 'weapon1b', 'helmet']) assert.ok(html.includes(`data-slot-id=\"${id}\"`), id);
  assert.ok(!html.includes('data-slot-id="weapon2a"'), 'set II hidden');
  assert.match(html, /data-weapon-set="2"/);
});

test('renderGear: filled slot shows resolved item + clear hook + card hover; escapes names', () => {
  const b = fixed({ gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, wishlist: [] } } });
  const html = renderGear(b, { ...ctx, resolveRef: () => ({ name: '<i>x</i>', iconUrl: null, url: null, cardUrl: '/base/iron-hat/card' }) });
  assert.ok(html.includes('&lt;i&gt;x&lt;/i&gt;'));
  assert.ok(!html.includes('<i>x</i>'));
  assert.match(html, /data-slot-clear="helmet"/);
  assert.match(html, /data-card-url="\/base\/iron-hat\/card"/);
});

test('renderGear: two-hander ghosts the off-hand and blocked off-hand renders a warning', () => {
  const b = fixed({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'big-maul' }, wishlist: [] },
    weapon1b: { item: { kind: 'base', slug: 'buckler' }, wishlist: [] },
  } });
  const html = renderGear(b, ctx);
  assert.match(html, /editor-checks/);
  assert.match(html, /is-warn/);
  assert.match(html, /editor-slot--violation/);
  const empty = fixed({ gear: { weapon1a: { item: { kind: 'base', slug: 'big-maul' }, wishlist: [] } } });
  assert.match(renderGear(empty, ctx), /editor-slot__ghost/);
});

test('renderGear: unassigned tray rows carry equip/remove hooks', () => {
  const b = fixed({ unassigned: [{ kind: 'gem', slug: 'spark' }, { kind: 'base', slug: 'iron-hat' }] });
  const html = renderGear(b, ctx);
  assert.match(html, /data-tray-equip="1"/);
  assert.match(html, /data-tray-remove="0"/);
});

test('initials: two-word cap, safe on empties', () => {
  assert.equal(initials('Lightning Arrow'), 'LA');
  assert.equal(initials('Pin'), 'P');
  assert.equal(initials(''), '?');
});

test('renderGear: checks card lists empty slots as info lines', () => {
  const html = renderGear(fixed(), ctx);
  assert.match(html, /editor-checks/);
  assert.match(html, /is-info/);
});

test('rankDocs: stable partition by ranked slugs', () => {
  const docs = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }];
  assert.deepEqual(rankDocs(docs, ['c', 'a']).map((d) => d.slug), ['c', 'a', 'b', 'd']);
  assert.deepEqual(rankDocs(docs, []).map((d) => d.slug), ['a', 'b', 'c', 'd']);
});

import { renderSkills, renderEditor, grantedRows } from '../public/js/editor-render.js';

const SKILL_PLANNER = { ...PLANNER,
  gems: {
    spark: { gemType: 'active', maxSupports: 5, color: 'blue', reqs: null },
    pierce: { gemType: 'support', maxSupports: 0, color: 'green', reqs: null },
    'storm-call': { gemType: 'active', maxSupports: 5, color: 'blue', reqs: null },
  },
  granted: { 'storm-amulet': ['storm-call'] },
};
const sctx = { planner: SKILL_PLANNER, resolveRef: resolve, weaponSet: 1 };

test('renderSkills: chain row with sockets, icons, remove/move hooks — no level UI', () => {
  const b = fixed({ skills: [{ gem: { slug: 'spark' }, level: 12, supports: [{ slug: 'pierce' }] }] });
  const html = renderSkills(b, sctx);
  assert.match(html, /data-gem-well="0"/);
  assert.ok(!html.includes('data-setup-level'), 'level control removed');
  assert.match(html, /data-setup-remove="0"/);
  assert.match(html, /data-setup-move="0:up"/);
  assert.match(html, /data-socket="s:0:0"/);
  assert.match(html, /editor-orb--g/);              // pierce is green ('green' fixture → g)
  assert.match(html, /data-socket="s:0:4"/);         // 5 sockets rendered
  assert.match(html, /editor-orb--empty/);
  assert.match(html, /data-setup-add/);
});

test('renderSkills: single-letter planner colors map to orb classes', () => {
  const planner = { ...SKILL_PLANNER, gems: { ...SKILL_PLANNER.gems, pierce: { gemType: 'support', maxSupports: 0, color: 'g', reqs: null } } };
  const b = fixed({ skills: [{ gem: { slug: 'spark' }, level: null, supports: [{ slug: 'pierce' }] }] });
  assert.match(renderSkills(b, { ...sctx, planner }), /editor-orb--g/);
});

test('grantedRows + renderSkills: equipped granting item yields a non-removable row', () => {
  const b = fixed({
    gear: { helmet: { item: { kind: 'unique', slug: 'storm-amulet' }, wishlist: [] } },
    grantedSupports: { 'storm-amulet:storm-call': [{ slug: 'pierce' }] },
  });
  const rows = grantedRows(b, SKILL_PLANNER);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { key: 'storm-amulet:storm-call', item: { kind: 'unique', slug: 'storm-amulet' },
    skill: 'storm-call', supports: [{ slug: 'pierce' }] });
  const html = renderSkills(b, sctx);
  assert.match(html, /editor-setup__source/);       // "from <item>" label present
  assert.match(html, /N:storm-amulet/);             // resolved granting item name
  assert.match(html, /data-socket="g:storm-amulet:storm-call:1"/);
  assert.ok(!/data-setup-remove="g:/.test(html), 'granted rows have no remove');
});

test('grantedRows: prototype-key item slug does not leak Object.prototype members', () => {
  const b = fixed({
    gear: { helmet: { item: { kind: 'unique', slug: '__proto__' }, wishlist: [] } },
  });
  assert.deepEqual(grantedRows(b, SKILL_PLANNER), []);
  assert.doesNotThrow(() => renderGear(b, sctx));
  assert.doesNotThrow(() => renderSkills(b, sctx));

  const c = fixed({
    gear: { helmet: { item: { kind: 'unique', slug: 'constructor' }, wishlist: [] } },
  });
  assert.deepEqual(grantedRows(c, SKILL_PLANNER), []);
  assert.doesNotThrow(() => renderGear(c, sctx));
  assert.doesNotThrow(() => renderSkills(c, sctx));
});

test('renderSkills: duplicate-support violation renders inline warning', () => {
  const b = fixed({ skills: [
    { gem: { slug: 'spark' }, level: null, supports: [{ slug: 'pierce' }] },
    { gem: { slug: 'spark' }, level: null, supports: [{ slug: 'pierce' }] },
  ] });
  assert.match(renderSkills(b, sctx), /editor-chain__warning/);
});

test('renderEditor: rail build switcher lists local builds, header carries manage hooks', () => {
  const b = fixed();
  const other = fixed({ uuid: () => 'b2', name: '<b>Other</b>' });
  const html = renderEditor(b, { ...sctx, builds: [b, other], currentId: 'b1', switcherOpen: true });
  assert.match(html, /data-switcher-toggle/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /href="#\/b\/b2"/);
  assert.match(html, /data-builds-new/);
  assert.ok(html.includes('&lt;b&gt;Other&lt;/b&gt;'));
  assert.ok(!html.includes('<b>Other</b>'));
  assert.match(html, /data-build-rename="b1"/);
  assert.match(html, /data-build-duplicate="b1"/);
  assert.match(html, /data-build-delete="b1"/);
});

const CLASS_PLANNER = { ...SKILL_PLANNER,
  classes: [
    { slug: 'ranger', name: 'Ranger', ascendancies: [
      { slug: 'deadeye', name: 'Deadeye' }, { slug: 'pathfinder', name: 'Pathfinder' }] },
    { slug: 'witch', name: 'Witch', ascendancies: [{ slug: 'lich', name: 'Lich' }] },
  ],
};

test('renderEditor: class picker lists classes, marks current, hooks present', () => {
  const b = fixed({ class: 'ranger', ascendancy: null });
  const html = renderEditor(b, { ...sctx, planner: CLASS_PLANNER, classPicker: 'class' });
  assert.match(html, /data-class-toggle="class"/);
  assert.match(html, /data-class-toggle="asc"/);
  assert.match(html, /data-set-class="witch"/);
  assert.match(html, /data-set-class=""/);            // clear option
  assert.ok(html.includes('>Ranger<') || /Ranger/.test(html), 'class name shown');
});

test('renderEditor: ascendancy picker scoped to the chosen class; disabled without one', () => {
  const b = fixed({ class: 'ranger', ascendancy: 'deadeye' });
  const html = renderEditor(b, { ...sctx, planner: CLASS_PLANNER, classPicker: 'asc' });
  assert.match(html, /data-set-asc="pathfinder"/);
  assert.ok(!html.includes('data-set-asc="lich"'), 'other classes hidden');
  const none = renderEditor(fixed(), { ...sctx, planner: CLASS_PLANNER });
  assert.match(none, /data-class-toggle="asc"[^>]*disabled/);
});

test('renderEditor: inline rename swaps the name button for an input', () => {
  const b = fixed({ name: 'My <b>Build</b>' });
  const html = renderEditor(b, { ...sctx, renaming: true });
  assert.match(html, /data-build-name-input/);
  assert.ok(html.includes('value="My &lt;b&gt;Build&lt;/b&gt;"'));
  assert.ok(!html.includes('data-build-rename'), 'button hidden while editing');
  const idle = renderEditor(b, sctx);
  assert.match(idle, /data-build-rename="b1"/);
  assert.ok(!idle.includes('data-build-name-input'));
});

test('renderEditor: switcher popover only renders while open', () => {
  const b = fixed();
  const closed = renderEditor(b, { ...sctx, builds: [b], currentId: 'b1', switcherOpen: false });
  assert.ok(!closed.includes('build-switcher__pop'));
  assert.match(closed, /aria-expanded="false"/);
});

test('renderEditor: view mode strips every edit affordance, offers Edit + share', () => {
  const b = fixed({
    gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, wishlist: [] } },
    skills: [{ gem: { slug: 'spark' }, level: null, supports: [{ slug: 'pierce' }] }],
    unassigned: [{ kind: 'base', slug: 'iron-hat' }],
    notes: 'note text', description: 'desc text',
  });
  const html = renderEditor(b, { ...sctx, mode: 'view', builds: [b], currentId: 'b1' });
  for (const hook of ['data-slot-id', 'data-slot-clear', 'data-setup-add', 'data-socket',
    'data-build-rename', 'data-description', 'data-tree-code', 'data-build-delete',
    'data-build-duplicate', 'data-gem-well', 'data-notes', 'data-tray-equip', 'data-class-toggle']) {
    assert.ok(!html.includes(hook), `${hook} must be absent in view mode`);
  }
  assert.match(html, /data-edit-build/);
  assert.match(html, /data-share/);
  assert.ok(!html.includes('editor-orb--empty'), 'empty sockets hidden');
  assert.match(html, /data-weapon-set="2"/);       // set toggle is view state, stays
  assert.ok(html.includes('note text') && html.includes('desc text'), 'content still shown');
  assert.match(html, /data-switcher-toggle/);       // own-build navigation stays
});

test('renderEditor: edit mode offers the view-published toggle', () => {
  assert.match(renderEditor(fixed(), sctx), /data-view-published/);
});

test('renderEditor: import mode — save-a-copy banner, no switcher/manage/share', () => {
  const { id, createdAt, updatedAt, ...canonical } = fixed();
  const html = renderEditor(canonical, { ...sctx, mode: 'import' });
  assert.match(html, /data-import-save/);
  assert.ok(!html.includes('data-switcher-toggle'));
  assert.ok(!html.includes('data-edit-build'));
  assert.ok(!html.includes('data-share'));
  assert.ok(!html.includes('data-slot-id'));
});

import { treeSummary } from '../public/js/editor-render.js';
import { encode, synthesizeState } from '../public/js/passive-code.js';

test('treeSummary: decodes allocated count, tolerates junk codes', () => {
  assert.deepEqual(treeSummary(fixed()), { saved: false, points: null });
  const code = encode(synthesizeState({ allocated: [101, 202, 303],
    ascOf: () => null, isAttr: () => false, attrOf: () => 'str' }));
  assert.deepEqual(treeSummary(fixed({ tree: { code, notablePriority: [] } })), { saved: true, points: 3 });
  assert.deepEqual(treeSummary(fixed({ tree: { code: '!!!', notablePriority: [] } })), { saved: true, points: null });
});

test('renderEditor: dossier shell — rail, header hooks, four chapters, escapes', () => {
  const b = fixed({ notes: 'hi <b>there</b>', description: 'desc <i>x</i>', tree: { code: null, notablePriority: [] } });
  const html = renderEditor(b, sctx);
  for (const id of ['id="gear"', 'id="skills"', 'id="tree"', 'id="notes"']) assert.ok(html.includes(id), id);
  assert.match(html, /data-rail-link/);
  assert.match(html, /data-share/);
  assert.match(html, /data-description/);
  assert.match(html, /data-tree-code/);
  assert.match(html, /data-notes/);
  assert.match(html, /href="\/passives"/);
  assert.ok(html.includes('hi &lt;b&gt;there&lt;/b&gt;'));
  assert.ok(html.includes('desc &lt;i&gt;x&lt;/i&gt;'));
});

test('treeSummary: non-v7 decodable garbage yields no point count', () => {
  // base64-decodes fine but is not a v7 code — decode() is lenient, so
  // treeSummary must gate on the version word.
  const junk = 'not-a-real-code';
  assert.deepEqual(treeSummary(fixed({ tree: { code: junk, notablePriority: [] } })),
    { saved: true, points: null });
});
