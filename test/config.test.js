import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandHome } from '../src/config.js';
import os from 'node:os';

test('expandHome expands leading ~', () => {
  assert.equal(expandHome('~/git/poe2data'), `${os.homedir()}/git/poe2data`);
});

test('expandHome leaves absolute paths untouched', () => {
  assert.equal(expandHome('/abs/path'), '/abs/path');
});
