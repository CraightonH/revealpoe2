import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGear, renderSummary, rankDocs, initials, modCardSections, baseRarity } from '../public/js/editor-render.js';
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

const MODPOOLS = {
  families: {
    life: { name: 'to maximum Life', origin: 'standard', scope: 'equipment', generic: '# to maximum Life',
      tiers: [{ id: 'life1', name: 'Hale', level: 1, gen: 'prefix', text: '+(10-19) to maximum Life' }] },
    corrarm: { name: 'increased Armour', origin: 'corrupted', scope: 'equipment', generic: '#% increased Armour',
      tiers: [{ id: 'carm1', name: 'Corrupted', level: 1, gen: 'corrupted', text: '(15-25)% increased Armour' }] },
    abyss: { name: 'increased Armour and Life', origin: 'desecrated', scope: 'equipment', boss: 'Ulaman',
      generic: '#% increased Armour and Life',
      tiers: [{ id: 'ab1', name: 'of Ulaman', level: 1, gen: 'suffix', text: '(30-40)% increased Armour, +10 Life' }] },
  }, bases: {}, uniques: {},
};

test('renderSummary shows attributes, level requirement, aggregates and warnings', () => {
  const ITEMMATH = {
    classBase: { warrior: { str: 15, dex: 7, int: 7, life: 16, mana: 30 } },
    gemLevel: {},
    items: { 'iron-hat': { req: { level: 8, str: 40, dex: 0, int: 0 }, lines: ['+(30-40) to maximum Life'] } },
  };
  const b = fixed({ class: 'warrior', gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, mods: [], corrupted: null } } });
  const html = renderSummary(b, { planner: PLANNER, itemMath: ITEMMATH, pools: MODPOOLS, treeLines: [], resolveRef: () => ({}) });
  assert.match(html, /rail-summary/);
  assert.match(html, /data-summary-toggle/);           // collapsible
  assert.match(html, /rail-summary__k">Str</);         // attribute row (short label)
  assert.match(html, /rail-summary__k">Life</);        // aggregate row
  assert.match(html, /Need 25 more Strength/);          // req 40 vs available 15 -> deficit 25 warning
  assert.match(html, /rail-summary__row--deficit/);     // deficit row is flagged
});

test('renderSummary honors the collapsed flag', () => {
  const ITEMMATH = { classBase: { warrior: { str: 15, dex: 7, int: 7, life: 16, mana: 30 } }, gemLevel: {}, items: {} };
  const b = fixed({ class: 'warrior' });
  const open = renderSummary(b, { planner: PLANNER, itemMath: ITEMMATH, pools: MODPOOLS, treeLines: [], resolveRef: () => ({}) });
  const shut = renderSummary(b, { planner: PLANNER, itemMath: ITEMMATH, pools: MODPOOLS, treeLines: [], resolveRef: () => ({}), summaryCollapsed: true });
  assert.ok(!/rail-summary collapsed/.test(open) && /aria-expanded="true"/.test(open));
  assert.match(shut, /rail-summary collapsed/);
  assert.match(shut, /aria-expanded="false"/);
});

test('modCardSections: separate corrupted + mods Stats blocks, empty when nothing chosen', () => {
  assert.deepEqual(modCardSections({ mods: [], corrupted: null }, MODPOOLS), { corrupted: '', mods: '' });
  const { corrupted, mods } = modCardSections({ mods: [{ affix: 'life', tier: 'life1' }],
    corrupted: { affix: 'corrarm', tier: 'carm1' } }, MODPOOLS);
  // Explicit mods render as an in-game .Stats block of .explicitMod lines,
  // each flagged P/S (left) with its tier rank T1–TX (right).
  assert.match(mods, /^<div class="separator"><\/div><div class="Stats">/);
  assert.match(mods, /explicitMod planner-mod/);
  assert.match(mods, /planner-mod__kind">P</);           // life is a prefix
  assert.match(mods, /planner-mod__tier">T1</);           // single-tier family → T1
  assert.ok(mods.includes('+(10-19) to maximum Life'));
  // A standard mod row is NOT flagged desecrated.
  assert.ok(!/planner-mod--desecrated/.test(mods));
  // Corrupted is its own separated .Stats section, tagged red.
  assert.match(corrupted, /^<div class="separator"><\/div><div class="Stats">/);
  assert.match(corrupted, /explicitMod corruptedMod/);
  assert.ok(corrupted.includes('(15-25)% increased Armour'));
});

test('modCardSections: a desecrated mod row carries the Abyssal-band class + S/tier', () => {
  const { mods } = modCardSections({ mods: [{ affix: 'abyss', tier: 'ab1' }], corrupted: null }, MODPOOLS);
  assert.match(mods, /explicitMod planner-mod planner-mod--desecrated/);
  assert.match(mods, /planner-mod__kind">S</);   // fixture desecrated tier is a suffix
  assert.match(mods, /planner-mod__tier">T1</);
});

test('renderGear: a filled well exposes data-slot-mods and a mods-edit affordance', () => {
  const b = fixed();
  b.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' },
    mods: [{ affix: 'life', tier: 'life1' }], corrupted: null };
  const html = renderGear(b, ctx);
  assert.match(html, /data-slot-mods="helmet"/);
  assert.match(html, /data-mods-edit="helmet"/);
});

test('baseRarity: normal / magic / rare by explicit-mod count (corrupted excluded)', () => {
  assert.equal(baseRarity({ mods: [] }), 'normal');
  assert.equal(baseRarity({ mods: [], corrupted: { affix: 'x', tier: 'y' } }), 'normal');
  assert.equal(baseRarity({ mods: [{ affix: 'a' }, { affix: 'b' }] }), 'magic');
  assert.equal(baseRarity({ mods: [{ affix: 'a' }, { affix: 'b' }, { affix: 'c' }] }), 'rare');
});

test('renderGear: base well takes a rarity class by mod count; unique stays is-unique', () => {
  const magic = fixed(); magic.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' },
    mods: [{ affix: 'life', tier: 'life1' }], corrupted: null };
  assert.match(renderGear(magic, ctx), /editor-slot--helmet[^"]*is-magic/);
  const rare = fixed(); rare.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' },
    mods: [{ affix: 'a' }, { affix: 'b' }, { affix: 'c' }], corrupted: null };
  assert.match(renderGear(rare, ctx), /editor-slot--helmet[^"]*is-rare/);
  const uniq = fixed(); uniq.gear.helmet = { item: { kind: 'unique', slug: 'the-x' },
    mods: [{ affix: 'a' }, { affix: 'b' }, { affix: 'c' }], corrupted: null };
  assert.match(renderGear(uniq, ctx), /editor-slot--helmet[^"]*is-unique/);
});

test('renderGear: wells for active weapon set + slotless slots, hooks present', () => {
  const html = renderGear(fixed(), ctx);
  for (const id of ['weapon1a', 'weapon1b', 'helmet']) assert.ok(html.includes(`data-slot-id=\"${id}\"`), id);
  assert.ok(!html.includes('data-slot-id="weapon2a"'), 'set II hidden');
  assert.match(html, /data-weapon-set="2"/);
});

test('renderGear: filled slot shows resolved item + clear hook without static card hover; escapes names', () => {
  const b = fixed({ gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, wishlist: [] } } });
  const html = renderGear(b, { ...ctx, resolveRef: () => ({ name: '<i>x</i>', iconUrl: null, url: null, cardUrl: '/base/iron-hat/card' }) });
  assert.ok(html.includes('&lt;i&gt;x&lt;/i&gt;'));
  assert.ok(!html.includes('<i>x</i>'));
  assert.match(html, /data-slot-clear="helmet"/);
  assert.ok(!html.includes('data-card-url="/base/iron-hat/card"'));
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

test('renderGear: checks card warns when a filled slot exceeds the prefix cap', () => {
  const prefixFamilies = Object.fromEntries(Array.from({ length: 4 }, (_, i) => {
    const n = i + 1;
    return [`prefix${n}`, {
      name: `Prefix ${n}`, origin: 'standard', scope: 'equipment', generic: `Prefix ${n}`,
      tiers: [{ id: `prefix${n}-tier`, name: `Tier ${n}`, level: 1, gen: 'prefix', text: `Prefix ${n}` }],
    }];
  }));
  const pools = {
    families: prefixFamilies,
    bases: { 'iron-hat': Object.keys(prefixFamilies).map((a) => ({ a })) },
    uniques: {},
  };
  const b = fixed();
  b.gear.helmet = {
    item: { kind: 'base', slug: 'iron-hat' },
    mods: Object.keys(prefixFamilies).map((affix) => ({ affix, tier: `${affix}-tier` })),
    corrupted: null,
  };

  const html = renderGear(b, { ...ctx, pools });
  assert.match(html, /<li class="is-warn">Helmet: 4 prefixes exceed 3<\/li>/);
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

test('renderSkills: granted chains are pinned above user setups', () => {
  const b = fixed({
    gear: { helmet: { item: { kind: 'unique', slug: 'storm-amulet' }, wishlist: [] } },
    skills: [{ gem: { slug: 'spark' }, level: null, supports: [] }],
  });
  const html = renderSkills(b, sctx);
  assert.ok(html.indexOf('editor-chain--granted') < html.indexOf('data-gem-well="0"'),
    'granted chain renders before the first user setup');
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
    'data-build-duplicate', 'data-gem-well', 'data-notes', 'data-tray-equip', 'data-class-toggle',
    'data-mods-edit']) {
    assert.ok(!html.includes(hook), `${hook} must be absent in view mode`);
  }
  assert.match(html, /data-edit-build/);
  assert.match(html, /data-share/);
  assert.ok(!html.includes('editor-orb--empty'), 'empty sockets hidden');
  assert.ok(!html.includes('Unassigned'), 'tray hidden in read-only');
  assert.ok(!html.includes('editor-checks'), 'checks are an editor helper, hidden in read-only');
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
  assert.match(html, /data-notes/);
  assert.match(html, /href="\/passives"/);
  assert.ok(html.includes('hi &lt;b&gt;there&lt;/b&gt;'));
  assert.ok(html.includes('desc &lt;i&gt;x&lt;/i&gt;'));
});

test('renderEditor: tree chapter mounts the embed, drops the code paste', () => {
  const b = fixed({ tree: { code: null, notablePriority: [] } });
  const html = renderEditor(b, sctx);
  assert.match(html, /data-tree-mount/);
  assert.match(html, /data-tree-points-summary/);
  assert.match(html, /data-notable-priority/);
  assert.match(html, /Notable Priority/);
  assert.ok(!html.includes('data-tree-code'), 'code paste input removed in edit mode');
  assert.match(html, /href="\/passives/);
});

test('renderEditor: read-only tree chapter is a static summary (no embed mount)', () => {
  const b = fixed({ tree: { code: null, notablePriority: [] } });
  const html = renderEditor(b, { ...sctx, mode: 'view' });
  assert.ok(!html.includes('data-tree-mount'), 'no interactive embed in read-only');
  assert.match(html, /Open the passive tree/);
});

test('treeSummary: non-v7 decodable garbage yields no point count', () => {
  // base64-decodes fine but is not a v7 code — decode() is lenient, so
  // treeSummary must gate on the version word.
  const junk = 'not-a-real-code';
  assert.deepEqual(treeSummary(fixed({ tree: { code: junk, notablePriority: [] } })),
    { saved: true, points: null });
});
