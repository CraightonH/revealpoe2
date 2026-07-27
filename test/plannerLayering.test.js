// test/plannerLayering.test.js
// The planner's stacking order is load-bearing and easy to break by editing one
// z-index in isolation, so assert the ORDER rather than the numbers.
//
// The subtlety worth remembering: `.dossier-rail` is `position: sticky`, and
// sticky ALWAYS creates a stacking context. That traps the build-switcher
// popover's own z-index inside the rail, so raising the popover can never lift it
// above the main column — the RAIL has to outrank the main column's positioned
// content. Removing the rail's z-index puts the class picker back on top of the
// open dropdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'public', 'css', 'builds.css'), 'utf8');

/** The z-index declared on a selector's rule block, as a number. */
function zIndexOf(selector) {
  // Match the rule block that starts with this exact selector.
  const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.[\]()*+?^$|\\-]/g, '\\$&')}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm');
  const m = css.match(re);
  assert.ok(m, `no rule found for ${selector}`);
  const z = m[3].match(/z-index:\s*(-?\d+)/);
  return z ? Number(z[1]) : null;
}

test('the sticky rail outranks the main column, so its dropdown is reachable', () => {
  const rail = zIndexOf('.dossier-rail');
  assert.ok(rail !== null,
    'the rail MUST carry an explicit z-index: it is position:sticky, which creates a '
    + 'stacking context that traps the switcher popover inside it');
  const classPop = zIndexOf('.class-pick__pop');
  assert.ok(rail > classPop,
    `rail (${rail}) must outrank .class-pick__pop (${classPop}) — the popover's own `
    + 'z-index cannot escape the rail\'s stacking context');
});

test('the modal item picker still covers the rail', () => {
  const rail = zIndexOf('.dossier-rail');
  const scrim = zIndexOf('.picker-overlay .picker-scrim');
  const panel = zIndexOf('.picker-panel');
  assert.ok(scrim > rail, `scrim (${scrim}) must cover the rail (${rail})`);
  assert.ok(panel > scrim, `panel (${panel}) must sit above its own scrim (${scrim})`);
});

test('the anchored mod picker stays below the rail and the modal', () => {
  const modPop = zIndexOf('.mod-picker-pop');
  assert.ok(modPop < zIndexOf('.dossier-rail'));
  assert.ok(modPop < zIndexOf('.picker-panel'));
});

// The picker popups drifted warm because they referenced tokens that do not
// exist and silently used their hardcoded fallbacks. Assert they are on the real
// palette, since that failure mode is invisible in code review.
test('the pickers use real design tokens, not phantom fallbacks', () => {
  const defined = new Set();
  const cssDir = path.join(import.meta.dirname, '..', 'public', 'css');
  for (const f of fs.readdirSync(cssDir).filter((x) => x.endsWith('.css'))) {
    const t = fs.readFileSync(path.join(cssDir, f), 'utf8');
    for (const m of t.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  }
  const phantom = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)\s*,/g)]
    .map((m) => m[1]).filter((n) => !defined.has(n)))];
  assert.deepEqual(phantom, [],
    'these fall back to a literal and drift from the palette when tokens change');
});

test('the picker panel sits on the app surface', () => {
  const m = css.match(/\.picker-panel\s*\{[^}]*\}/);
  assert.ok(m, '.picker-panel rule not found');
  assert.match(m[0], /background:\s*var\(--bg-surface\)/, 'must share the app surface');
  assert.ok(!/#14130f/.test(m[0]), 'the warm literal must not come back');
});
