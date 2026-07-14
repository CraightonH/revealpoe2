import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { listKeystones, getKeystone, listNotables, getNotable, getPassiveNode } from '../src/data/passiveTree.js';
import { passiveNodes } from '../scripts/graph/passives.js';

test('passiveNodes emits keystones + notables with resolved stat lines', () => {
  const { nodes } = passiveNodes();
  assert.ok(nodes.length > 1000, `passive nodes=${nodes.length}`);
  const withStats = nodes.filter((n) => n.props.statLines.length > 0);
  assert.ok(withStats.length > 0);
  // kind is one of keystone/notable
  for (const n of nodes) assert.ok(['keystone', 'notable'].includes(n.props.kind));
});

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
    it('iconUrl resolves to a self-hosted image path', () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      assert.ok(k.iconUrl.startsWith('/static/img/'));
      assert.ok(k.iconUrl.endsWith('.webp'));
    });
    it("Zealot's Oath has statRaw plain text without HTML tags", () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      assert.ok(typeof k.statRaw === 'string');
      assert.ok(k.statRaw.includes('Energy Shield'));
      assert.ok(!k.statRaw.includes('<'));
    });
    it('returns null for unknown id', () => {
      assert.equal(getKeystone('nonexistent_id'), null);
    });
  });

  describe('listNotables', () => {
    it('returns 984 non-ascendancy notables', () => {
      assert.equal(listNotables().length, 984);
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
    it('Fast Acting Toxins statRaw is plain text containing 12', () => {
      const n = getNotable('ailments38');
      assert.ok(typeof n.statRaw === 'string');
      assert.ok(n.statRaw.includes('12'));
      assert.ok(!n.statRaw.includes('<'));
    });
    it('returns null for unknown id', () => {
      assert.equal(getNotable('nope'), null);
    });
  });

  describe('getPassiveNode', () => {
    it('finds a keystone by id', () => {
      const n = getPassiveNode('passive_keystone_zealots_oath');
      assert.equal(n.name, "Zealot's Oath");
      assert.equal(n.kind, 'keystone');
    });
    it('finds an ascendancy notable (excluded by getNotable) and themes it', () => {
      const n = getPassiveNode('AscendancyDruid1Notable4');
      assert.ok(n);
      assert.equal(n.ascendancy, 'Druid1');
      assert.equal(n.ascendancyName, 'Oracle');
      assert.equal(n.charClass, 'Druid');
      assert.equal(n.ascColor, '#4fa3a3');
    });
    it('returns null for unknown id', () => {
      assert.equal(getPassiveNode('nope'), null);
    });
    it('resolves a granted skill on a stats-less node', () => {
      const n = getPassiveNode('AscendancyMonk1Notable4'); // Hollow Resonance Technique
      assert.equal(n.statLines.length, 0);
      assert.ok(n.grantedSkill);
      assert.equal(n.grantedSkill.name, 'Hollow Resonance');
      assert.equal(n.grantedSkill.slug, 'hollow-resonance');
    });
    it('leaves grantedSkill null for ordinary stat nodes', () => {
      assert.equal(getKeystone('passive_keystone_zealots_oath').grantedSkill, null);
    });
  });

  describe('kind discriminator', () => {
    it('keystones have kind "keystone"', () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      assert.equal(k.kind, 'keystone');
    });
    it('notables have kind "notable"', () => {
      const n = getNotable('armour_and_evasion53');
      assert.equal(n.kind, 'notable');
    });
    it('listed keystones all report kind "keystone"', () => {
      assert.ok(listKeystones().every((k) => k.kind === 'keystone'));
    });
    it('listed notables all report kind "notable"', () => {
      assert.ok(listNotables().every((n) => n.kind === 'notable'));
    });
  });
});
