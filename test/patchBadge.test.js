// test/patchBadge.test.js — the header badge that says which patch/league the
// site's data describes. Rendered from build/graph.json meta.game (see
// scripts/graph/gameMeta.js); desktop shows the league wordmark + version pill,
// mobile keeps only the pill (CSS), and with no meta the badge is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { graphMeta } from '../src/data/graph.js';

const views = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views');
const env = nunjucks.configure(views, { autoescape: true });
const render = (GAME) => env.render('partials/patch-badge.njk', { GAME });

const FULL = {
  patch: '0.5.5',
  build: '4.5.5.1.6',
  league: { id: 'Forbidden Rites', name: 'Forbidden Rites', logoDds: 'Art/2DArt/Logos/POELeagueLogoForbiddenRites.dds' },
  dataFetchedAt: '2026-09-07T12:00:00-06:00',
};

test('badge renders wordmark, name fallback and version pill from meta.game', () => {
  const html = render(FULL);
  assert.match(html, /class="patch-badge"/);
  assert.match(html, /src="\/static\/img\/Art\/2DArt\/Logos\/POELeagueLogoForbiddenRites\.webp"/);
  assert.match(html, /alt="Forbidden Rites"/);
  assert.match(html, /class="patch-badge__version">0\.5\.5</);
  // Wordmark failing to load falls back to the league name, never a broken image.
  assert.match(html, /onerror=/);
  assert.match(html, /class="patch-badge__name">Forbidden Rites</);
});

test('badge tooltip carries the full client build and the data date', () => {
  const html = render(FULL);
  assert.match(html, /title="[^"]*4\.5\.5\.1\.6[^"]*"/);
  assert.match(html, /title="[^"]*2026-09-07[^"]*"/);
});

test('badge with a patch but no league shows only the version pill', () => {
  const html = render({ ...FULL, league: null });
  assert.match(html, /class="patch-badge__version">0\.5\.5</);
  assert.doesNotMatch(html, /<img/);
});

test('badge is absent when the data carries no patch (pre-refresh mirror)', () => {
  assert.equal(render({ patch: null, build: null, league: null }).trim(), '');
  assert.equal(render(undefined).trim(), '');
});

test('graphMeta exposes the artifact meta, and the layout renders the badge from it', async () => {
  const meta = graphMeta();
  assert.ok(meta && typeof meta === 'object');
  assert.ok('game' in meta, 'meta.game is stamped by the build');
  const res = await request(createApp()).get('/');
  const expected = render(meta.game).trim();
  if (expected) assert.ok(res.text.includes(expected), 'layout header includes the badge markup');
  else assert.doesNotMatch(res.text, /patch-badge/);
});
