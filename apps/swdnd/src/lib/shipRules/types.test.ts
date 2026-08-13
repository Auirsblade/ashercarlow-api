// apps/swdnd/src/lib/shipRules/types.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild } from './types';

test('emptyShipBuild matches the backend emptyShipBuildJson mirror exactly', () => {
  expect(emptyShipBuild('Ghost')).toEqual({
    schemaVersion: 1,
    identity: { name: 'Ghost', sizeId: '', tier: 0 },
    abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, increases: [] },
    equipment: [],
    modifications: [],
    play: {
      hull: 0, shields: 0, hullDiceSpent: 0, shieldDiceSpent: 0,
      ammoSpent: {}, conditions: [], systemDamage: 0, notes: '',
    },
    overrides: {},
    houseRuled: [],
  });
});

test('two empty builds do not share mutable sub-objects', () => {
  const a = emptyShipBuild('A');
  const b = emptyShipBuild('B');
  a.equipment.push({ id: 'e1', ref: 'w', kind: 'weapon' });
  a.play.conditions.push('Ionized');
  a.play.ammoSpent.e1 = 2;
  expect(b.equipment).toEqual([]);
  expect(b.play.conditions).toEqual([]);
  expect(b.play.ammoSpent).toEqual({});
});
