import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /healthz returns ok', async () => {
  const app = createApp();
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.text, 'ok');
});

test('GET /uniques returns 200 with unique names', async () => {
  const app = createApp();
  const res = await request(app).get('/uniques');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Astramentis'));
  assert.ok(res.text.includes('Unique Item Index'));
  assert.ok(res.text.includes('unique-index-search'));
  assert.ok(res.text.includes('/static/js/unique-index.js'));
  assert.ok(res.text.includes('item-index-pane'));
  assert.ok(res.text.includes('item-index-sheet'));
  const rowCount = (res.text.match(/class="gem-index-row [^"]*item-index-row[^"]*"\s+href="\/unique\/[^"/]+"/g) ?? []).length;
  assert.equal(rowCount, app.locals.uniqueCount());
});

test('GET /unique/astramentis returns 200', async () => {
  const app = createApp();
  const res = await request(app).get('/unique/astramentis');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Astramentis'));
  assert.ok(res.text.includes('class="gem-detail item-detail"'));
  assert.ok(res.text.includes('data-item-slug="astramentis"'));
});

test('GET /unique/not-a-real-unique returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/unique/not-a-real-unique');
  assert.equal(res.status, 404);
});

test('GET /bases returns the 34 item-class rows with an initial class detail', async () => {
  const app = createApp();
  const res = await request(app).get('/bases');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Weapons'));
  assert.ok(res.text.includes('Modifier Index'));
  assert.ok(res.text.includes('base-index-search'));
  assert.ok(res.text.includes('/static/js/base-index.js'));
  assert.ok(res.text.includes('item-index-pane'));
  assert.ok(res.text.includes('item-index-sheet'));
  assert.ok(res.text.includes('data-search-slugs="'));
  assert.ok(res.text.includes('base-class-detail item-detail'));
  assert.ok(res.text.includes('Mods, augments, and base types'));
  assert.ok(!res.text.includes('label="Class"'), 'class dropdown is removed');
  const rowCount = (res.text.match(/class="gem-index-row [^"]*item-index-row[^"]*"\s+href="\/bases\/[^"/]+"/g) ?? []).length;
  assert.equal(rowCount, 34);
  assert.equal(rowCount, app.locals.baseCount());
  assert.doesNotMatch(res.text, /href="\/base\//, 'base cards do not expose dedicated detail routes');
  assert.match(res.text, /href="\/bases#[^"]+" data-card-url="\/base\//, 'base cards link to their class while retaining hover fragments');
});

test('GET /bases/amulet returns 200 with base items', async () => {
  const app = createApp();
  const res = await request(app).get('/bases/amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Stellar Amulet'));
  assert.ok(res.text.includes('class="page page--column base-class-detail item-detail"'));
  assert.ok(res.text.includes('data-item-slug="amulet"'));
});

test('GET /bases/jewel now returns the shared class detail', async () => {
  const res = await request(createApp()).get('/bases/jewel');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('data-item-slug="jewel"'));
  assert.ok(res.text.includes('Item Affixes'));
});

test('GET /base/stellar-amulet returns 200', async () => {
  const app = createApp();
  const res = await request(app).get('/base/stellar-amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Stellar Amulet'));
  assert.ok(res.text.includes('class="gem-detail item-detail"'));
  assert.ok(res.text.includes('data-item-slug="stellar-amulet"'));
});

test('GET /base/not-a-real-base returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/base/not-a-real-base');
  assert.equal(res.status, 404);
});

test('GET /mod/:typeSlug (standalone mod page) is deprecated → 404', async () => {
  const app = createApp();
  const res = await request(app).get('/mod/increasedlife');
  assert.equal(res.status, 404);
});

test('GET /mod/:typeSlug/card returns the base-target flyout with /bases links', async () => {
  const app = createApp();
  const res = await request(app).get('/mod/increasedlife/card');
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/bases(?:\?|#)/);
  assert.doesNotMatch(res.text, /<html/); // fragment, not full page
});

test('GET /mod/not-a-real-mod/card returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/mod/not-a-real-mod/card');
  assert.equal(res.status, 404);
});

test('GET /bases/amulet includes the class affix section', async () => {
  const app = createApp();
  const res = await request(app).get('/bases/amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Item Affixes'), 'renders the affix section');
  assert.ok(res.text.includes('Standard'), 'renders the Standard (basic currency) origin');
  assert.ok(res.text.includes('affix-table'), 'renders the prefix/suffix tables');
  assert.ok(res.text.includes('affix-tier-row'), 'renders collapsible lower-tier rows');
  assert.ok(res.text.includes('aria-expanded="false"'), 'tier rows start collapsed');
});

test('GET /base/stellar-amulet points to the class affix page', async () => {
  const app = createApp();
  const res = await request(app).get('/base/stellar-amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('/bases#amulet'), 'links to the class on the bases index');
  assert.ok(!res.text.includes('affix-table'), 'no per-base affix tables');
});

test("GET /keystone/passive_keystone_zealots_oath returns 200 with Zealot's Oath", async () => {
  const app = createApp();
  const res = await request(app).get('/keystone/passive_keystone_zealots_oath');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Zealot'));
  assert.match(res.text, /class="gem-detail item-detail"/);
  assert.match(res.text, /data-item-slug="passive_keystone_zealots_oath"/);
});

test('GET /keystone/not-a-real-keystone returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/keystone/not-a-real-keystone');
  assert.equal(res.status, 404);
});

// The old passive browse pages were deprecated in favor of the interactive
// passive tree (/passives); their routes are gone.
for (const gone of ['/keystones', '/ascendancies', '/ascendancy/Ranger1']) {
  test(`GET ${gone} is deprecated (404)`, async () => {
    const res = await request(createApp()).get(gone);
    assert.equal(res.status, 404);
  });
}

test('GET /gems returns the complete gem index and initial detail pane', async () => {
  const app = createApp();
  const res = await request(app).get('/gems');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Herald of Ash'));
  assert.ok(res.text.includes('Gem Index'));
  assert.ok(res.text.includes('gem-index-pane'));
  assert.ok(res.text.includes('data-filter-count'));
  assert.ok(res.text.includes('data-gem-index-search'));
  assert.ok(res.text.includes('aria-controls="gem-index-rows"'));
  assert.ok(res.text.includes('data-gem-index-empty'));
  assert.ok(res.text.includes('/static/js/gem-index-search.js'));
  assert.ok(res.text.includes('item-index-row'));
  assert.ok(res.text.includes('data-item-index-search'));
  assert.ok(res.text.includes('gem-index-sheet'));
  const rowCount = (res.text.match(/class="gem-index-row[^\"]*"\s+href="\/gem\/[^"/]+"/g) ?? []).length;
  assert.equal(rowCount, app.locals.gemCount());
  assert.doesNotMatch(res.text, /data-pane-url/);
});

test('GET /notable/ailments38 returns 200 with Fast Acting Toxins', async () => {
  const app = createApp();
  const res = await request(app).get('/notable/ailments38');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Fast Acting Toxins'));
  assert.match(res.text, /class="gem-detail item-detail"/);
  assert.match(res.text, /data-item-slug="ailments38"/);
});

test('GET /theorycraft?q=onslaught renders the no-JS master list and keeps htmx parity', async () => {
  const res = await request(createApp()).get('/theorycraft?q=onslaught');
  assert.equal(res.status, 200);
  assert.match(res.text, /class="[^\"]*theorycraft-index/);
  assert.match(res.text, /hx-get="\/theorycraft\/results"/);
  assert.match(res.text, /data-item-kind="gem"/);
  assert.match(res.text, /data-item-kind="unique"/);
  assert.match(res.text, /data-item-kind="augment"/);
  assert.match(res.text, /href="\/augment\/[^\"]+\/card"/);
});

test('GET /notable/not-a-real-notable returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/notable/not-a-real-notable');
  assert.equal(res.status, 404);
});

test('GET /search?q=maximum+life returns Affix results', async () => {
  const app = createApp();
  const res = await request(app).get('/search?q=maximum+life');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Affix'));
});

test('GET /passives renders the tree shell', async () => {
  const app = createApp();
  const res = await request(app).get('/passives');
  assert.equal(res.status, 200);
  assert.match(res.text, /<canvas/);
  assert.match(res.text, /passive-tree\.js/);
});

test('GET /builds returns the planner shell', async () => {
  const app = createApp();
  const res = await request(app).get('/builds');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('data-builds-root'));
  assert.ok(res.text.includes('data-builds-view'));
  assert.ok(res.text.includes('/static/js/builds-page.js'));
  assert.ok(res.text.includes('/static/css/builds.css'));
  assert.ok(res.text.includes('<noscript>'));
});

test('site nav links to /builds on every page', async () => {
  const app = createApp();
  const res = await request(app).get('/gems');
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/builds"/);
});

test('every page loads the add-to-build handler', async () => {
  const app = createApp();
  const res = await request(app).get('/gems');
  assert.ok(res.text.includes('/static/js/add-to-build.js'));
});

test('/builds shell loads the editor modules', async () => {
  const app = createApp();
  const res = await request(app).get('/builds');
  assert.ok(res.text.includes('/static/js/build-editor.js') || res.text.includes('builds-page.js'),
    'editor reachable from shell');
  assert.ok(res.text.includes('/static/css/planner-art.css'));
});
