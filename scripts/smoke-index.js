#!/usr/bin/env node
// Post-deploy smoke for the shared gem/unique/base indexes. Run against any URL:
//   node scripts/smoke-index.js http://localhost:8788
// scripts/smoke-gems.js remains a compatible alias.
import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] || 'https://revealpoe2.com').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const failures = [];
const errors = [];

function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const surfaces = [
  { name: 'gems', path: '/gems', slug: 'arc', crossPrefix: '/gem/', dismiss: 'close' },
  { name: 'uniques', path: '/uniques', slug: 'astramentis', crossPrefix: '/base/', dismiss: 'scrim' },
  { name: 'bases', path: '/bases', slug: 'stellar-amulet', crossPrefix: '/unique/', dismiss: 'back' },
];

async function settle(page) {
  await new Promise((resolve) => setTimeout(resolve, 900));
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 10000 }).catch(() => {});
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });

  for (const surface of surfaces) {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(`${surface.name} desktop: ${error}`));
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${BASE}${surface.path}#${surface.slug}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await settle(page);
    const deep = await page.evaluate(() => ({
      hash: location.hash.slice(1),
      selected: document.querySelector('.item-index-row.is-selected')?.dataset.itemSlug,
      detail: document.querySelector('.item-index-pane .item-detail')?.dataset.itemSlug,
    }));
    check(`${surface.name}: desktop deep link`, deep.hash === surface.slug && deep.selected === surface.slug && deep.detail === surface.slug, JSON.stringify(deep));

    const link = await page.$(`.item-index-pane a[href^="${surface.crossPrefix}"]`);
    check(`${surface.name}: pane cross-link exists`, !!link);
    if (link) {
      await link.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
      await settle(page);
      const nav = await page.evaluate(() => ({
        hash: location.hash.slice(1),
        selected: document.querySelector('.item-index-row.is-selected')?.dataset.itemSlug,
        detail: document.querySelector('.item-index-pane .item-detail')?.dataset.itemSlug,
      }));
      check(`${surface.name}: in-pane navigation uses index selection`, !!nav.hash && nav.hash === nav.selected && nav.selected === nav.detail, JSON.stringify(nav));
    }
    await page.close();

    const mobile = await browser.newPage();
    mobile.on('pageerror', (error) => errors.push(`${surface.name} mobile: ${error}`));
    await mobile.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
    await mobile.goto(`${BASE}${surface.path}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await mobile.evaluate((slug) => document.querySelector(`.item-index-row[data-item-slug="${slug}"]`).click(), surface.slug);
    await settle(mobile);
    check(`${surface.name}: mobile sheet opens`, await mobile.evaluate(() => document.querySelector('.item-index-sheet')?.classList.contains('is-open')));
    const sheetLink = await mobile.$(`.item-index-sheet__content a[href^="${surface.crossPrefix}"]`);
    check(`${surface.name}: sheet cross-link exists`, !!sheetLink);
    if (sheetLink) {
      await sheetLink.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
      await settle(mobile);
      const sheetNav = await mobile.evaluate(() => ({
        open: document.querySelector('.item-index-sheet')?.classList.contains('is-open'),
        hash: location.hash.slice(1),
        selected: document.querySelector('.item-index-row.is-selected')?.dataset.itemSlug,
        detail: document.querySelector('.item-index-sheet .item-detail')?.dataset.itemSlug,
      }));
      check(`${surface.name}: in-sheet navigation stays indexed`, sheetNav.open && sheetNav.hash === sheetNav.selected && sheetNav.selected === sheetNav.detail, JSON.stringify(sheetNav));
    }
    if (surface.dismiss === 'close') await mobile.click('.item-index-sheet__close');
    else if (surface.dismiss === 'scrim') {
      // The sheet covers the scrim's center; click in the exposed sliver above it.
      const sheetTop = await mobile.evaluate(() => document.querySelector('.item-index-sheet').getBoundingClientRect().top);
      await mobile.mouse.click(195, Math.max(5, Math.floor(sheetTop / 2)));
    }
    else {
      await mobile.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await settle(mobile);
      if (await mobile.evaluate(() => document.querySelector('.item-index-sheet')?.classList.contains('is-open'))) {
        await mobile.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }
    await settle(mobile);
    check(`${surface.name}: mobile ${surface.dismiss} dismissal`, await mobile.evaluate(() => !document.querySelector('.item-index-sheet')?.classList.contains('is-open')));
    await mobile.close();
  }

  check('no page errors', errors.length === 0, errors.join('; '));
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} smoke check(s) failed`);
    process.exit(1);
  }
  console.log('\nall index smoke checks passed');
})().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
