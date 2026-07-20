#!/usr/bin/env node
// Post-deploy smoke test for the /gems Gem Index (desktop master-detail +
// mobile sheet). Run against any base URL:
//   node scripts/smoke-gems.js                        # https://revealpoe2.com
//   node scripts/smoke-gems.js http://localhost:8788  # local static preview
// Requires Google Chrome installed (uses puppeteer-core). Exits non-zero on
// any failed check or page error. Use Node fetch/puppeteer, not curl — the
// corporate SSL_CERT_FILE breaks TLS to Cloudflare.
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] || 'https://revealpoe2.com';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
  const errors = [];

  // Desktop: deep link, extract-from-page pane, in-pane navigation
  const d = await browser.newPage();
  d.on('pageerror', (e) => errors.push(`desktop: ${e}`));
  await d.setViewport({ width: 1600, height: 1000 });
  await d.goto(`${BASE}/gems#arc`, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));
  const deep = await d.evaluate(() => ({
    sel: document.querySelector('.gem-index-row.is-selected')?.dataset.gemSlug,
    pane: document.querySelector('.gem-index-pane .gem-detail')?.dataset.gemSlug,
  }));
  check('desktop deep-link selects arc', deep.sel === 'arc' && deep.pane === 'arc', JSON.stringify(deep));
  const hadLink = await d.evaluate(() => !!document.querySelector('.gem-index-pane a[href^="/gem/"]'));
  check('pane has gem cross-links', hadLink);
  if (hadLink) {
    await d.evaluate(() => document.querySelector('.gem-index-pane a[href^="/gem/"]').click());
    await new Promise((r) => setTimeout(r, 2000));
    const nav = await d.evaluate(() => ({
      hash: location.hash.slice(1),
      pane: document.querySelector('.gem-index-pane .gem-detail')?.dataset.gemSlug,
    }));
    check('in-pane navigation updates hash + pane', !!nav.hash && nav.hash === nav.pane, JSON.stringify(nav));
  }
  await d.close();

  // Mobile: row tap opens the details sheet
  const m = await browser.newPage();
  m.on('pageerror', (e) => errors.push(`mobile: ${e}`));
  await m.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await m.goto(`${BASE}/gems`, { waitUntil: 'networkidle2', timeout: 90000 });
  await m.evaluate(() => document.querySelectorAll('.gem-index-row')[2].click());
  await new Promise((r) => setTimeout(r, 2000));
  check('mobile sheet opens on row tap', await m.evaluate(() => !!document.querySelector('[class*="sheet"][class*="open"]')));

  check('no page errors', errors.length === 0, errors.join('; '));
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} smoke check(s) failed`);
    process.exit(1);
  }
  console.log('\nall smoke checks passed');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
