import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/data/theorycraft.js';
import { createPinStore } from '../public/js/pin-store.js';
import { getGem } from '../src/data/gems.js';
import { getNode } from '../src/data/graph.js';

test('parseQuery: bare words become free-text terms', () => {
  assert.deepEqual(parseQuery('cold chaos').terms, [
    { kind: 'text', value: 'cold', negate: false },
    { kind: 'text', value: 'chaos', negate: false },
  ]);
});

test('parseQuery: known field:value becomes a field term', () => {
  assert.deepEqual(parseQuery('type:support').terms, [
    { kind: 'field', field: 'type', value: 'support', negate: false },
  ]);
});

test('parseQuery: leading dash negates', () => {
  assert.deepEqual(parseQuery('-type:unique -chaos').terms, [
    { kind: 'field', field: 'type', value: 'unique', negate: true },
    { kind: 'text', value: 'chaos', negate: true },
  ]);
});

test('parseQuery: quoted phrase is one free-text term', () => {
  assert.deepEqual(parseQuery('"cast speed"').terms, [
    { kind: 'text', value: 'cast speed', negate: false },
  ]);
});

test('parseQuery: unknown field degrades to free text (field name dropped)', () => {
  assert.deepEqual(parseQuery('dmg:fire').terms, [
    { kind: 'text', value: 'fire', negate: false },
  ]);
});

test('parseQuery: empty/whitespace yields no terms', () => {
  assert.deepEqual(parseQuery('').terms, []);
  assert.deepEqual(parseQuery('   ').terms, []);
  assert.deepEqual(parseQuery(null).terms, []);
});

import { docMatches, runQuery } from '../src/data/theorycraft.js';

const FIXTURE = [
  { name: 'Onslaught Support', slug: 'onslaught-support', url: '/gems#onslaught-support', category: 'support',
    iconUrl: null, subtitle: 'Support', color: 'g', tags: ['support'], req: ['dex'],
    grants: [], text: 'onslaught support grants onslaught movement and cast speed' },
  { name: 'Cold Snap', slug: 'cold-snap', url: '/gems#cold-snap', category: 'gem',
    iconUrl: null, subtitle: 'Spell', color: 'b', tags: ['cold', 'spell', 'area'],
    req: ['int'], grants: [], text: 'cold snap deals cold damage and chill' },
  { name: 'Test Amulet', slug: 'test-amulet', url: '/uniques#test-amulet', category: 'unique',
    iconUrl: null, subtitle: 'Amber Amulet', color: '', tags: ['amulet'], req: [],
    grants: [], text: 'test amulet chaos resistance onslaught' },
];

test('pin store persists ordered versioned refs and resolves fresh docs', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const store = createPinStore({ storage });
    store.add({ category: 'gem', slug: 'cold-snap', name: 'content must not persist' });
    store.add({ category: 'base', slug: 'crude-bow', classSlug: 'bow', hint: 'also content' });
    assert.deepEqual(JSON.parse(values.get('tcPins')), {
      v: 1,
      pins: [
        { category: 'gem', slug: 'cold-snap' },
        { category: 'base', slug: 'crude-bow', classSlug: 'bow' },
      ],
    });
    const freshGem = { category: 'gem', slug: 'cold-snap', name: 'Fresh Cold Snap' };
    const freshBase = { category: 'base', slug: 'crude-bow', classSlug: 'bow', name: 'Fresh Crude Bow' };
    const result = store.resolve([freshGem, freshBase]);
    assert.deepEqual(result.resolved.map((item) => item.doc), [freshGem, freshBase]);
    assert.equal(result.removed, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('pin store drops unresolved refs and notifies subscribers', () => {
  const values = new Map([['tcPins', JSON.stringify({
    v: 1,
    pins: [{ category: 'gem', slug: 'removed-gem' }, { category: 'unique', slug: 'astramentis' }],
  })]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const store = createPinStore({ storage });
    let notified = 0;
    store.subscribe(() => { notified++; });
    const result = store.resolve([{ category: 'unique', slug: 'astramentis', name: 'Astramentis' }]);
    assert.equal(result.removed, 1);
    assert.deepEqual(store.getRefs(), [{ category: 'unique', slug: 'astramentis' }]);
    assert.equal(notified, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('runQuery: free text matches across categories', () => {
  const r = runQuery('onslaught', { docs: FIXTURE });
  assert.equal(r.total, 2);
  assert.deepEqual(r.groups.map((g) => g.category), ['support', 'unique']);
});

test('runQuery: type field constrains to a category', () => {
  const r = runQuery('type:support', { docs: FIXTURE });
  assert.equal(r.total, 1);
  assert.equal(r.groups[0].items[0].name, 'Onslaught Support');
});

test('runQuery: exclusion removes matches', () => {
  const r = runQuery('onslaught -type:unique', { docs: FIXTURE });
  assert.equal(r.total, 1);
  assert.equal(r.groups[0].category, 'support');
});

test('runQuery: quoted phrase matches the blob', () => {
  const r = runQuery('"cold damage"', { docs: FIXTURE });
  assert.equal(r.total, 1);
  assert.equal(r.groups[0].items[0].name, 'Cold Snap');
});

test('runQuery: color and tag fields', () => {
  assert.equal(runQuery('color:b', { docs: FIXTURE }).total, 1);
  assert.equal(runQuery('tag:cold', { docs: FIXTURE }).total, 1);
});

test('runQuery: origin field constrains to uniques of that origin', () => {
  const docs = [
    { name: 'Vaal Unq', slug: 'v', url: '/uniques#v', category: 'unique', iconUrl: null, subtitle: '', color: '', tags: [], req: [], grants: [], origin: 'vaal', text: 'vaal unq' },
    { name: 'Ezo Unq', slug: 'e', url: '/uniques#e', category: 'unique', iconUrl: null, subtitle: '', color: '', tags: [], req: [], grants: [], origin: 'ezomyte', text: 'ezo unq' },
    // A gem that merely mentions "vaal" in its text must NOT match origin:vaal.
    { name: 'Vaal Gem', slug: 'g', url: '/gems#g', category: 'gem', iconUrl: null, subtitle: '', color: '', tags: [], req: [], grants: [], text: 'vaal themed gem' },
  ];
  const r = runQuery('origin:vaal', { docs });
  assert.equal(r.total, 1);
  assert.equal(r.groups[0].category, 'unique');
  assert.equal(r.groups[0].items[0].name, 'Vaal Unq');
});

test('runQuery: empty query is flagged empty', () => {
  const r = runQuery('', { docs: FIXTURE });
  assert.equal(r.empty, true);
  assert.equal(r.groups.length, 0);
});

test('runQuery: per-group cap reports shown vs total', () => {
  const many = Array.from({ length: 150 }, (_, i) => ({
    name: `Gem ${i}`, slug: `g${i}`, url: `/gems#g${i}`, category: 'gem', iconUrl: null,
    subtitle: '', color: '', tags: [], req: [], grants: [], text: 'onslaught',
  }));
  const r = runQuery('onslaught', { docs: many, capPerGroup: 100 });
  assert.equal(r.groups[0].total, 150);
  assert.equal(r.groups[0].shown, 100);
  assert.equal(r.groups[0].items.length, 100);
});

import { allDocs } from '../src/data/theorycraft.js';

test('allDocs: cultivated mod text is searchable (origin:vaal fork -> Atziri)', () => {
  const docs = allDocs();
  const r = runQuery('origin:vaal fork', { docs });
  const uniques = (r.groups.find((g) => g.category === 'unique')?.items ?? []).map((i) => i.name);
  assert.ok(uniques.includes("Atziri's Contempt"), 'a cultivated Fork mod should match');
});

test('allDocs: builds a multi-category index', () => {
  const docs = allDocs();
  assert.ok(docs.length > 100, 'expected a large index');
  const cats = new Set(docs.map((d) => d.category));
  for (const c of ['gem', 'unique', 'affix', 'keystone', 'base']) {
    assert.ok(cats.has(c), `expected category ${c} present`);
  }
});

test('allDocs: a known gem doc carries deep text and fields', () => {
  const herald = allDocs().find((d) => d.url === '/gems#herald-of-ash');
  assert.ok(herald, 'Herald of Ash should be indexed');
  assert.equal(herald.category, 'gem');
  assert.match(herald.text, /herald/);
  assert.ok(Array.isArray(herald.tags));
});

test('allDocs: public urls target master-detail indexes while cards stay dedicated', () => {
  const docs = allDocs();
  const gem = docs.find((d) => d.slug === 'herald-of-ash' && d.category === 'gem');
  const unique = docs.find((d) => d.slug === 'astramentis' && d.category === 'unique');
  const base = docs.find((d) => d.slug === 'stellar-amulet' && d.category === 'base');
  assert.deepEqual([gem.url, gem.cardUrl], ['/gems#herald-of-ash', '/gem/herald-of-ash/card']);
  assert.deepEqual([unique.url, unique.cardUrl], ['/uniques#astramentis', '/unique/astramentis/card']);
  assert.deepEqual([base.url, base.cardUrl], ['/bases#amulet', '/base/stellar-amulet/card']);
});

test('allDocs: is cached (same array on repeat calls)', () => {
  assert.equal(allDocs(), allDocs());
});

import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /theorycraft renders the page with a query input', async () => {
  const res = await request(createApp()).get('/theorycraft');
  assert.equal(res.status, 200);
  assert.match(res.text, /hx-get="\/theorycraft\/results"/);
  assert.match(res.text, /Theory Crafting/);
  assert.match(res.text, /theorycraft-index/);
  assert.match(res.text, /item-index-workspace/);
  assert.match(res.text, /item-index-pane/);
  assert.match(res.text, /item-index-sheet/);
  assert.match(res.text, /data-tc-pin-tray/);
  assert.match(res.text, /data-tc-pin-items/);
  assert.match(res.text, /data-tc-detail-pin/);
  assert.match(res.text, /\/static\/js\/theorycraft-client\.js/);
});

test('GET /theorycraft/results?q=herald returns grouped compact index rows', async () => {
  const res = await request(createApp()).get('/theorycraft/results?q=herald');
  assert.equal(res.status, 200);
  assert.match(res.text, /Skill Gems/);
  assert.match(res.text, /Herald of Ash/);
  assert.match(res.text, /tc-index-group__heading/);
  assert.match(res.text, /tc-index-row/);
  assert.match(res.text, /data-item-kind="gem"/);
  assert.match(res.text, /tc-kind-chip/);
  assert.match(res.text, /data-tc-pin-toggle/);
  assert.match(res.text, /aria-pressed="false"/);
});

test('GET /theorycraft/results renders keystone matches as selectable rows', async () => {
  const res = await request(createApp()).get('/theorycraft/results?q=zealot');
  assert.equal(res.status, 200);
  assert.match(res.text, /data-item-kind="keystone"/);
  assert.match(res.text, /href="\/passives\?node=\d+"/);
  assert.doesNotMatch(res.text, /PassivePopup/);
});

test('GET /theorycraft/results renders affixes as fragment-backed rows', async () => {
  const res = await request(createApp()).get('/theorycraft/results?q=type%3Aaffix');
  assert.equal(res.status, 200);
  assert.match(res.text, /data-item-kind="affix"/);
  assert.match(res.text, /href="\/mod\/[^\"]+\/card"/);
});

test('GET /theorycraft/results with empty q shows the prompt', async () => {
  const res = await request(createApp()).get('/theorycraft/results?q=');
  assert.equal(res.status, 200);
  assert.match(res.text, /tc-empty/);
  assert.match(res.text, /Choose an example above/);
});

test('runQuery: color word and color letter match the same gems (real index)', () => {
  const docs = allDocs();
  const byWord = runQuery('color:green', { docs }).total;
  const byLetter = runQuery('color:g', { docs }).total;
  assert.ok(byLetter > 0, 'color:g should match gems');
  assert.equal(byWord, byLetter, 'color:green should equal color:g');
});

test('runQuery: type field narrows to a real category (real index)', () => {
  const docs = allDocs();
  const r = runQuery('type:support', { docs });
  assert.ok(r.total > 0);
  assert.ok(r.groups.every((g) => g.category === 'support'));
});

test('GET /theorycraft renders the search help panel with clickable examples', async () => {
  const res = await request(createApp()).get('/theorycraft');
  assert.equal(res.status, 200);
  // collapsible panel + summary
  assert.match(res.text, /class="tc-help"/);
  assert.match(res.text, /How to search/);
  // term labels that live ONLY in the panel
  assert.match(res.text, /<code>grants:<\/code>/);
  assert.match(res.text, /<code>req:<\/code>/);
  // closed-set values for type are spelled out
  assert.match(res.text, /keystone, notable, base/);
  // clickable example chips carry data-q
  assert.match(res.text, /class="tc-example" data-q="type:keystone"/);
  assert.match(res.text, /class="tc-example" data-q="color:green"/);
  // page-scoped script is referenced
  assert.match(res.text, /\/static\/js\/theorycraft\.js/);
});

test('gem search docs include granted-skill display names from the graph', () => {
  // find a gem whose first granted skill resolves to a named skill node
  const docs = allDocs().filter((d) => d.category === 'gem' || d.category === 'support' || d.category === 'spirit');
  const sample = docs.find((d) => {
    const gem = getGem(d.slug);
    const key = gem?.grants_skills?.[0];
    const node = key ? getNode(key) : null;
    return node && node.name && node.name !== key;
  });
  assert.ok(sample, 'expected at least one gem with a named granted skill');
  const gem = getGem(sample.slug);
  const skillName = getNode(gem.grants_skills[0]).name.toLowerCase();
  assert.ok(sample.text.includes(skillName), 'granted skill name should be in the doc text');
});

test('gem search docs exclude key-fallback grant names (no raw skill keys in index)', () => {
  // Skills with an empty source display_name resolve to a node whose name IS
  // its key; those must not appear in grants/search text.
  const docs = allDocs().filter((d) => ['gem', 'support', 'spirit'].includes(d.category));
  for (const d of docs) {
    const gem = getGem(d.slug);
    for (const key of gem?.grants_skills ?? []) {
      const node = getNode(key);
      if (node && node.name === node.id) {
        // key-fallback node: its key must not have been added to grants
        assert.ok(
          !d.grants.includes(key.toLowerCase()),
          `raw key leaked into grants for ${d.url}: ${key}`,
        );
      }
    }
  }
});
