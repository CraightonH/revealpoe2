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
  { name: 'gems', path: '/gems', slug: 'arc', linkPrefix: '/gems#', linkMode: 'local', dismiss: 'close' },
  { name: 'uniques', path: '/uniques', slug: 'astramentis', linkPrefix: '/bases#', linkMode: 'cross', targetPath: '/bases', dismiss: 'scrim' },
  { name: 'bases', path: '/bases', slug: 'bow', linkPrefix: '/bases#', linkMode: 'local', dismiss: 'back' },
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

    if (surface.name === 'bases') {
      await page.type('[data-item-index-search]', 'crossbow bolt');
      await settle(page);
      const search = await page.evaluate(() => ({
        visible: Array.from(document.querySelectorAll('.item-index-row')).filter((row) => row.style.display !== 'none').map((row) => row.dataset.itemSlug),
        selected: document.querySelector('.item-index-row.is-selected')?.dataset.itemSlug,
        detail: document.querySelector('.item-index-pane .item-detail')?.dataset.itemSlug,
      }));
      check('bases: base-document search maps to class row', search.visible.length === 1 && search.visible[0] === 'crossbow' && search.selected === 'crossbow' && search.detail === 'crossbow', JSON.stringify(search));
    }

    const link = await page.$(`.item-index-pane a[href^="${surface.linkPrefix}"]`);
    check(`${surface.name}: pane index link exists`, !!link);
    if (link) {
      await link.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
      await settle(page);
      const nav = await page.evaluate(() => ({
        pathname: location.pathname,
        hash: location.hash.slice(1),
        selected: document.querySelector('.item-index-row.is-selected')?.dataset.itemSlug,
        detail: document.querySelector('.item-index-pane .item-detail')?.dataset.itemSlug,
      }));
      const ok = surface.linkMode === 'cross'
        ? nav.pathname === surface.targetPath && !!nav.hash
        : !!nav.hash && nav.hash === nav.selected && nav.selected === nav.detail;
      check(`${surface.name}: in-pane navigation ${surface.linkMode === 'cross' ? 'uses target index' : 'selects in place'}`, ok, JSON.stringify(nav));
    }
    await page.close();

    const mobile = await browser.newPage();
    mobile.on('pageerror', (error) => errors.push(`${surface.name} mobile: ${error}`));
    await mobile.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
    await mobile.goto(`${BASE}${surface.path}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await mobile.evaluate((slug) => document.querySelector(`.item-index-row[data-item-slug="${slug}"]`).click(), surface.slug);
    await settle(mobile);
    check(`${surface.name}: mobile sheet opens`, await mobile.evaluate(() => document.querySelector('.item-index-sheet')?.classList.contains('is-open')));
    let sheetLink = await mobile.$(`.item-index-sheet__content a[href^="${surface.linkPrefix}"]`);
    check(`${surface.name}: sheet index link exists`, !!sheetLink);
    if (sheetLink && surface.linkMode === 'local') {
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
    if (surface.linkMode === 'cross') {
      await mobile.evaluate((slug) => document.querySelector(`.item-index-row[data-item-slug="${slug}"]`).click(), surface.slug);
      await settle(mobile);
      sheetLink = await mobile.$(`.item-index-sheet__content a[href^="${surface.linkPrefix}"]`);
      if (sheetLink) {
        await sheetLink.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
        await settle(mobile);
      }
      const destination = await mobile.evaluate(() => ({ pathname: location.pathname, hash: location.hash }));
      check(`${surface.name}: in-sheet link uses target index`, !!sheetLink && destination.pathname === surface.targetPath && !!destination.hash, JSON.stringify(destination));
    }
    await mobile.close();
  }

  // Theory Crafting is a client-rendered mixed-kind table. Exercise a full-page
  // detail and a fragment-only kind from the same query, then its typed hash and
  // mobile sheet contract.
  const theory = await browser.newPage();
  theory.on('pageerror', (error) => errors.push(`theorycraft desktop: ${error}`));
  await theory.setViewport({ width: 1600, height: 1000 });
  await theory.goto(`${BASE}/theorycraft?q=onslaught`, { waitUntil: 'networkidle2', timeout: 90000 });
  await theory.waitForSelector('.tc-index-row[data-item-kind="gem"]');
  await theory.click('.tc-index-row[data-item-kind="gem"]');
  await settle(theory);
  const theoryGem = await theory.evaluate(() => ({
    query: new URLSearchParams(location.search).get('q'),
    hash: location.hash.slice(1),
    kind: document.querySelector('.tc-index-row.is-selected')?.dataset.itemKind,
    detail: document.querySelector('.item-index-pane .item-detail')?.dataset.itemSlug,
  }));
  check('theorycraft: desktop gem detail', theoryGem.query === 'onslaught' && theoryGem.hash.startsWith('gem:') && theoryGem.kind === 'gem' && !!theoryGem.detail, JSON.stringify(theoryGem));

  await theory.click('.tc-index-row[data-item-kind="augment"]');
  await settle(theory);
  const theoryFragment = await theory.evaluate(() => ({
    hash: location.hash.slice(1),
    kind: document.querySelector('.tc-index-row.is-selected')?.dataset.itemKind,
    fragment: !!document.querySelector('.item-index-pane .tc-fragment-detail'),
    note: !!document.querySelector('.item-index-pane .tc-fragment-detail__note'),
  }));
  check('theorycraft: desktop fragment detail', theoryFragment.hash.startsWith('augment:') && theoryFragment.kind === 'augment' && theoryFragment.fragment && theoryFragment.note, JSON.stringify(theoryFragment));

  await theory.goto(`${BASE}/theorycraft?q=onslaught#gem:savage-fury`, { waitUntil: 'networkidle2', timeout: 90000 });
  await settle(theory);
  const theoryRestore = await theory.evaluate(() => ({
    query: new URLSearchParams(location.search).get('q'),
    hash: location.hash.slice(1),
    selected: document.querySelector('.tc-index-row.is-selected')?.dataset.itemSlug,
    detail: document.querySelector('.item-index-pane .item-detail')?.dataset.itemSlug,
  }));
  check('theorycraft: query + kind hash restore', theoryRestore.query === 'onslaught' && theoryRestore.hash === 'gem:savage-fury' && theoryRestore.selected === 'savage-fury' && theoryRestore.detail === 'savage-fury', JSON.stringify(theoryRestore));
  await theory.close();

  const theoryMobile = await browser.newPage();
  theoryMobile.on('pageerror', (error) => errors.push(`theorycraft mobile: ${error}`));
  await theoryMobile.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await theoryMobile.goto(`${BASE}/theorycraft?q=onslaught`, { waitUntil: 'networkidle2', timeout: 90000 });
  await theoryMobile.waitForSelector('.tc-index-row[data-item-kind="augment"]');
  await theoryMobile.click('.tc-index-row[data-item-kind="augment"]');
  await settle(theoryMobile);
  const theorySheet = await theoryMobile.evaluate(() => ({
    open: document.querySelector('.item-index-sheet')?.classList.contains('is-open'),
    hash: location.hash.slice(1),
    fragment: !!document.querySelector('.item-index-sheet .tc-fragment-detail'),
  }));
  check('theorycraft: mobile fragment sheet', theorySheet.open && theorySheet.hash.startsWith('augment:') && theorySheet.fragment, JSON.stringify(theorySheet));
  await theoryMobile.close();

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
