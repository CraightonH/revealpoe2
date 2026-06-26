// test/passiveTreeView.test.js
// Pure-helper unit tests for worldToScreen / screenToWorld in passive-tree.js.
// These helpers are DOM-free, so they run directly under node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldToScreen, screenToWorld } from '../public/js/passive-tree.js';

// ---------------------------------------------------------------------------
// worldToScreen correctness
// ---------------------------------------------------------------------------

test('worldToScreen: identity view (ox=0, oy=0, scale=1)', () => {
  const view = { ox: 0, oy: 0, scale: 1 };
  const result = worldToScreen(view, 100, 200);
  assert.strictEqual(result.x, 100);
  assert.strictEqual(result.y, 200);
});

test('worldToScreen: scale=2 doubles world coords', () => {
  const view = { ox: 0, oy: 0, scale: 2 };
  const result = worldToScreen(view, 10, 20);
  assert.strictEqual(result.x, 20);
  assert.strictEqual(result.y, 40);
});

test('worldToScreen: offset is applied in screen space', () => {
  const view = { ox: 50, oy: 100, scale: 1 };
  const result = worldToScreen(view, 0, 0);
  assert.strictEqual(result.x, 50);
  assert.strictEqual(result.y, 100);
});

test('worldToScreen: scale + offset combined', () => {
  const view = { ox: 10, oy: 20, scale: 3 };
  const result = worldToScreen(view, 5, 10);
  // x = 10 + 5*3 = 25
  assert.strictEqual(result.x, 25);
  // y = 20 + 10*3 = 50
  assert.strictEqual(result.y, 50);
});

// ---------------------------------------------------------------------------
// screenToWorld correctness
// ---------------------------------------------------------------------------

test('screenToWorld: identity view inverts to original point', () => {
  const view = { ox: 0, oy: 0, scale: 1 };
  const result = screenToWorld(view, 100, 200);
  assert.strictEqual(result.x, 100);
  assert.strictEqual(result.y, 200);
});

test('screenToWorld: scale=2 halves screen coords', () => {
  const view = { ox: 0, oy: 0, scale: 2 };
  const result = screenToWorld(view, 20, 40);
  assert.strictEqual(result.x, 10);
  assert.strictEqual(result.y, 20);
});

// ---------------------------------------------------------------------------
// Round-trip: screenToWorld(worldToScreen(p)) ≈ p
// ---------------------------------------------------------------------------

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

test('round-trip: arbitrary view + point', () => {
  const view   = { ox: 123.4, oy: -56.7, scale: 1.75 };
  const wx = 4200, wy = -3800;
  const sp = worldToScreen(view, wx, wy);
  const wp = screenToWorld(view, sp.x, sp.y);
  assert.ok(approx(wp.x, wx), `x round-trip failed: got ${wp.x}, expected ${wx}`);
  assert.ok(approx(wp.y, wy), `y round-trip failed: got ${wp.y}, expected ${wy}`);
});

test('round-trip: scale < 1 (zoomed out)', () => {
  const view   = { ox: 800, oy: 600, scale: 0.05 };
  const wx = 15000, wy = 12000;
  const sp = worldToScreen(view, wx, wy);
  const wp = screenToWorld(view, sp.x, sp.y);
  assert.ok(approx(wp.x, wx), `x round-trip failed: got ${wp.x}, expected ${wx}`);
  assert.ok(approx(wp.y, wy), `y round-trip failed: got ${wp.y}, expected ${wy}`);
});

test('round-trip: negative world coords', () => {
  const view   = { ox: 500, oy: 400, scale: 2 };
  const wx = -100, wy = -250;
  const sp = worldToScreen(view, wx, wy);
  const wp = screenToWorld(view, sp.x, sp.y);
  assert.ok(approx(wp.x, wx), `x round-trip: got ${wp.x}, expected ${wx}`);
  assert.ok(approx(wp.y, wy), `y round-trip: got ${wp.y}, expected ${wy}`);
});

test('round-trip: large tree coordinates (typical passive tree range)', () => {
  // Passive tree world coords are roughly ±20000.
  const view   = { ox: 960, oy: 540, scale: 0.04 };
  const wx = -18500, wy = 17300;
  const sp = worldToScreen(view, wx, wy);
  const wp = screenToWorld(view, sp.x, sp.y);
  assert.ok(approx(wp.x, wx), `x round-trip: got ${wp.x}, expected ${wx}`);
  assert.ok(approx(wp.y, wy), `y round-trip: got ${wp.y}, expected ${wy}`);
});
