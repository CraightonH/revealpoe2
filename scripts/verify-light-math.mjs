#!/usr/bin/env node
// Manual DOM-glue verification for Phase 7 light math. Node:test covers the pure
// build-math core + the itemMath projector; this covers what only a browser can:
// the editor loads item-math.json and renders the Summary card (attributes +
// aggregates + warnings), live.
//   npm run dev                                         # dev server on :3000
//   node scripts/verify-light-math.mjs                  # default localhost:3000
//   BASE=http://localhost:8788 node scripts/verify-light-math.mjs   # static dist
import puppeteer from 'puppeteer-core';

const BASE = (process.env.BASE || process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
const page = await browser.newPage();
// A fresh visit to /builds auto-creates + opens a build (the planner landing).
await page.goto(`${BASE}/builds`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.rail-summary', { timeout: 10000 });
const txt = await page.$eval('.rail-summary', (el) => el.textContent.replace(/\s+/g, ' ').trim());
await browser.close();

const ok = /Summary/.test(txt) && /Str/.test(txt) && /Life/.test(txt) && /Lv/.test(txt);
if (!ok) { console.error('FAIL: Summary card missing expected rows —', txt.slice(0, 200)); process.exit(1); }
console.log('PASS: Summary card renders attributes + aggregates —', txt.slice(0, 120));
