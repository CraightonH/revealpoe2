import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listKeystones, getKeystone, listNotables, getNotable, listAscendancies, getAscendancy } from '../src/data/passiveTree.js';

describe('passiveTree', () => {
  describe('listKeystones', () => {
    it('returns 33 keystones', () => {
      assert.equal(listKeystones().length, 33);
    });
    it('each keystone has id, name, iconUrl, statLines', () => {
      const k = listKeystones()[0];
      assert.ok(k.id);
      assert.ok(k.name);
      assert.ok(typeof k.iconUrl === 'string');
      assert.ok(Array.isArray(k.statLines));
    });
    it('is sorted by name', () => {
      const names = listKeystones().map((k) => k.name);
      assert.deepEqual(names, [...names].sort());
    });
  });

  describe('getKeystone', () => {
    it("returns Zealot's Oath by id", () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      assert.ok(k);
      assert.equal(k.name, "Zealot's Oath");
      assert.equal(k.id, 'passive_keystone_zealots_oath');
    });
    it("Zealot's Oath statLines contains energy shield text", () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      const joined = k.statLines.join('\n');
      assert.ok(joined.includes('Energy Shield') || joined.includes('[EnergyShield|Energy Shield]'));
    });
    it('iconUrl resolves to CDN URL', () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      assert.ok(k.iconUrl.startsWith('https://'));
    });
    it('returns null for unknown id', () => {
      assert.equal(getKeystone('nonexistent_id'), null);
    });
  });

  describe('listNotables', () => {
    it('returns 974 non-ascendancy notables', () => {
      assert.equal(listNotables().length, 974);
    });
    it('each notable has id, name, statLines', () => {
      const n = listNotables()[0];
      assert.ok(n.id);
      assert.ok(n.name);
      assert.ok(Array.isArray(n.statLines));
    });
    it('no notable has ascendancy field set', () => {
      assert.ok(listNotables().every((n) => !n.ascendancy));
    });
  });

  describe('getNotable', () => {
    it('returns Fast Acting Toxins by id', () => {
      const n = getNotable('ailments38');
      assert.ok(n);
      assert.equal(n.name, 'Fast Acting Toxins');
    });
    it('Fast Acting Toxins statLines includes the numeric value 12', () => {
      const n = getNotable('ailments38');
      const joined = n.statLines.join(' ');
      assert.ok(joined.includes('12'));
    });
    it('returns null for unknown id', () => {
      assert.equal(getNotable('nope'), null);
    });
  });

  describe('listAscendancies', () => {
    it('returns 23 valid ascendancies', () => {
      assert.equal(listAscendancies().length, 23);
    });
    it('each ascendancy has id, name, charClass, notables array', () => {
      const a = listAscendancies()[0];
      assert.ok(a.id);
      assert.ok(a.name);
      assert.ok(a.charClass);
      assert.ok(Array.isArray(a.notables));
    });
    it('no ascendancy name contains [DNT', () => {
      assert.ok(listAscendancies().every((a) => !a.name.includes('[DNT')));
    });
  });

  describe('getAscendancy', () => {
    it('returns Deadeye by id Ranger1', () => {
      const a = getAscendancy('Ranger1');
      assert.ok(a);
      assert.equal(a.name, 'Deadeye');
      assert.equal(a.charClass, 'Ranger');
    });
    it('Deadeye has notables', () => {
      const a = getAscendancy('Ranger1');
      assert.ok(a.notables.length > 0);
    });
    it('returns null for unknown id', () => {
      assert.equal(getAscendancy('Blah99'), null);
    });
  });
});
