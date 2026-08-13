// apps/swdnd/src/lib/shipRules/constants.test.ts
import { expect, test } from 'bun:test';
import type { RefShipSize } from './types';
import {
  HULL_DIE_BY_SIZE, MAX_SHIP_TIER, ROF_SIZE_MULTIPLIER, SHIP_ABILITIES, SHIP_ROLES, TIER_AC_BONUS,
  diceTotal, hardpointBudget, hullDiceCount, modSlotBudget, shieldDiceCount, shipConditionOptions, suiteBudget,
} from './constants';

const medium: RefShipSize = {
  id: 'med', name: 'Medium Starship', key: 'medium',
  hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200,
  hardpointMult: 1.5, modBaseCap: 30, modMaxSuitesBase: 3, modMaxSuitesMult: 1,
  description: '',
};
const small: RefShipSize = { ...medium, key: 'small', hullDie: 6, hullDiceStart: 3, shieldDie: 6, shieldDiceStart: 3, hardpointMult: 1, modMaxSuitesBase: -1, modMaxSuitesMult: 1 };

test('the six ship abilities and six SOTG crew roles are fixed constants', () => {
  expect(SHIP_ABILITIES).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  expect(SHIP_ROLES).toEqual(['coordinator', 'gunner', 'mechanic', 'operator', 'pilot', 'technician']);
  expect(MAX_SHIP_TIER).toBe(5);
});

test('tier AC bonus matches the pack "Armor Class Improvement" feature', () => {
  // "+1 at 2nd Tier … +2 at 3rd, +3 at 4th, +4 at 5th"
  expect(TIER_AC_BONUS).toEqual([0, 0, 1, 2, 3, 4]);
});

test('hull dice die by size matches the ingested starship_sizes rows', () => {
  expect(HULL_DIE_BY_SIZE).toEqual({ tiny: 4, small: 6, medium: 8, large: 10, huge: 12, gargantuan: 20 });
});

test('rate-of-fire size multipliers', () => {
  expect(ROF_SIZE_MULTIPLIER).toEqual({ tiny: 1, small: 1, medium: 1.5, large: 2.5, huge: 2, gargantuan: 3 });
});

test('diceTotal is max on the first die, average-rounded-up after (matches hullDiceRolled)', () => {
  expect(diceTotal(8, 5)).toBe(28);   // pack: [8,5,5,5,5]
  expect(diceTotal(6, 3)).toBe(14);   // pack: [6,4,4]
  expect(diceTotal(4, 1)).toBe(4);    // pack: [4]
  expect(diceTotal(20, 11)).toBe(130); // pack: [20,11 x10]
  expect(diceTotal(8, 0)).toBe(0);
});

test('hull and shield dice counts start from the size row and gain one per tier', () => {
  expect(hullDiceCount(medium, 0)).toBe(5);
  expect(hullDiceCount(medium, 3)).toBe(8);
  expect(shieldDiceCount(small, 2)).toBe(5);
});

test('budget formulas', () => {
  expect(hardpointBudget(medium, 0)).toBe(2);   // ceil(1.5 * 1)
  expect(hardpointBudget(medium, 3)).toBe(6);   // ceil(1.5 * 4)
  expect(modSlotBudget(0)).toBe(1);
  expect(modSlotBudget(5)).toBe(6);
  expect(suiteBudget(medium, 2)).toBe(5);       // 3 + 1*2
  expect(suiteBudget(small, 0)).toBe(0);        // max(0, -1 + 0)
  expect(suiteBudget(small, 2)).toBe(1);        // -1 + 2
});

test('condition options list plain conditions plus levelled Slowed 1-4', () => {
  const opts = shipConditionOptions();
  expect(opts).toContain('Ionized');
  expect(opts).toContain('Tractored');
  expect(opts).toContain('Slowed 1');
  expect(opts).toContain('Slowed 4');
  expect(opts).not.toContain('Slowed 5');
});
