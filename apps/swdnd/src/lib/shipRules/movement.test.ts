import { expect, test } from 'bun:test';
import { emptyShipBuild, type RefShipSize, type ShipReferenceData } from './types';
import { shipSpeed, shipTurnSpeed } from './movement';

const size = (key: RefShipSize['key'], turn: number): RefShipSize => ({
  id: key, name: key, key, hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: turn, hardpointMult: 1, modBaseCap: 0,
  modMaxSuitesBase: 0, modMaxSuitesMult: 0, description: '',
});

const ref: ShipReferenceData = {
  sizes: { medium: size('medium', 200), gargantuan: size('gargantuan', 50) },
  armor: {}, equipment: {}, weapons: {}, modifications: {},
};

test('speed and turn speed come straight from the size row', () => {
  const b = emptyShipBuild('Ghost');
  b.identity.sizeId = 'medium';
  expect(shipSpeed(b, ref)).toBe(300);
  expect(shipTurnSpeed(b, ref)).toBe(200);
  b.identity.sizeId = 'gargantuan';
  expect(shipTurnSpeed(b, ref)).toBe(50);
});

test('an unpicked or unknown size yields 0 rather than NaN', () => {
  const b = emptyShipBuild('Nowhere');
  expect(shipSpeed(b, ref)).toBe(0);
  expect(shipTurnSpeed(b, ref)).toBe(0);
});
