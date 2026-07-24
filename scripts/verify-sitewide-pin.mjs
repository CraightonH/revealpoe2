#!/usr/bin/env node
// Manual DOM-glue verification for the site-wide "Add to Theory Craft" pin
// affordance (Phase 6). Node:test covers the pure pin-store core; this covers
// what only a browser can: clicking the pin on a non-theorycraft page writes to
// the tcPins store, and the pinned chip renders on /theorycraft afterward.
//   npm run dev                                   # dev server on :3000
//   node scripts/verify-sitewide-pin.mjs          # default localhost:3000
//   BASE=http://localhost:8788 node scripts/verify-sitewide-pin.mjs   # static dist
import puppeteer from 'puppeteer-core';

const BASE = (process.env.BASE || process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fails = [];
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
// Loads /uniques, clicks the first Add-to-Theory-Craft pin, then loads
// /theorycraft and asserts the pinned chip appears in the tray.
const page = await browser.newPage();
await page.goto(`${BASE}/uniques`, { waitUntil: 'networkidle0' });
await page.click('[data-pin-kind]');
await page.waitForSelector('.build-toast');
await page.goto(`${BASE}/theorycraft`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.tc-pin-chip', { timeout: 5000 });
const chips = await page.$$eval('.tc-pin-chip', (els) => els.length);
if (chips < 1) { console.error('FAIL: pin did not appear on /theorycraft'); process.exit(1); }
console.log(`PASS: ${chips} pinned chip(s) on /theorycraft`);
await browser.close();
