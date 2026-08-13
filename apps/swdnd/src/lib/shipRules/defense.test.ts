// apps/swdnd/src/lib/shipRules/defense.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type RefShipArmor, type RefShipSize, type ShipReferenceData } from './types';
import {
  maxHull, maxShields, shieldRegen, shipArmorClass, shipDamageReduction, shipHullDice,
} from './defense';

const medium: RefShipSize = {
  id: 'med', name: 'Medium Starship', key: 'medium',
  hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5,
  modBaseCap: 30, modMaxSuitesBase: 3, modMaxSuitesMult: 1, description: '',
};
// Only used to pin the rounding mode on shieldRegen with a die small enough
// that floor(die * coefficient) and round(die * coefficient) actually differ.
const small: RefShipSize = {
  id: 'sm', name: 'Small Starship', key: 'small',
  hullDie: 6, hullDiceStart: 3, shieldDie: 4, shieldDiceStart: 3,
  spaceSpeed: 350, turnSpeed: 250, hardpointMult: 1,
  modBaseCap: 20, modMaxSuitesBase: -1, modMaxSuitesMult: 1, description: '',
};
const armor = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});

const ref: ShipReferenceData = {
  sizes: { med: medium, sm: small },
  armor: {
    light: armor({ id: 'light', name: 'Lightweight Armor', dexCap: null, damageReduction: 0 }),
    deflect: armor({ id: 'deflect', name: 'Deflection Armor', dexCap: 2, damageReduction: 3 }),
    reinf: armor({ id: 'reinf', name: 'Reinforced Armor', dexCap: 0, damageReduction: 6 }),
    directional: armor({ id: 'directional', kind: 'shield', baseAc: 0, capacityCoefficient: 1, regenCoefficient: 1 }),
    fortress: armor({ id: 'fortress', kind: 'shield', baseAc: 0, capacityCoefficient: 1.5, regenCoefficient: 0.667 }),
    quick: armor({ id: 'quick', kind: 'shield', baseAc: 0, capacityCoefficient: 0.667, regenCoefficient: 1.5 }),
  },
  equipment: {}, weapons: {}, modifications: {}, deployments: {}, deploymentFeatures: {},
};

function ship(opts: { tier?: number; dex?: number; con?: number; str?: number; size?: string; install?: Array<[string, 'armor' | 'shield']> } = {}) {
  const b = emptyShipBuild('Ghost');
  b.identity.sizeId = opts.size ?? 'med';
  b.identity.tier = opts.tier ?? 0;
  b.abilities.base = { str: opts.str ?? 10, dex: opts.dex ?? 10, con: opts.con ?? 10, int: 10, wis: 10, cha: 10 };
  b.equipment = (opts.install ?? []).map(([r, kind], i) => ({ id: `e${i}`, ref: r, kind }));
  return b;
}

test('AC is 10 + Dex mod + tier bonus with no armor installed', () => {
  expect(shipArmorClass(ship({ dex: 16 }), ref)).toBe(13);              // 10 + 3 + 0
  expect(shipArmorClass(ship({ dex: 16, tier: 2 }), ref)).toBe(14);     // +1 at tier 2
  expect(shipArmorClass(ship({ dex: 16, tier: 5 }), ref)).toBe(17);     // +4 at tier 5
});

test('installed armor caps the Dex contribution', () => {
  // Deflection caps at +2, Reinforced at +0, Lightweight is uncapped.
  expect(shipArmorClass(ship({ dex: 18, install: [['deflect', 'armor']] }), ref)).toBe(12);  // 10 + min(4,2)
  expect(shipArmorClass(ship({ dex: 18, install: [['reinf', 'armor']] }), ref)).toBe(10);    // 10 + 0
  expect(shipArmorClass(ship({ dex: 18, install: [['light', 'armor']] }), ref)).toBe(14);    // 10 + 4
  // A negative Dex still applies through a cap (the cap is a ceiling, not a floor).
  expect(shipArmorClass(ship({ dex: 6, install: [['deflect', 'armor']] }), ref)).toBe(8);
});

test('damage reduction comes from the installed armor, 0 when bare', () => {
  expect(shipDamageReduction(ship(), ref)).toBe(0);
  expect(shipDamageReduction(ship({ install: [['deflect', 'armor']] }), ref)).toBe(3);
  expect(shipDamageReduction(ship({ install: [['reinf', 'armor']] }), ref)).toBe(6);
});

test('hull dice come from the size row and grow with tier', () => {
  expect(shipHullDice(ship(), ref)).toEqual({ die: 8, count: 5 });
  expect(shipHullDice(ship({ tier: 3 }), ref)).toEqual({ die: 8, count: 8 });
});

test('max hull is the dice total plus the Con modifier per die', () => {
  // tier 0 Medium: d8 x5 -> 8 + 4*5 = 28; Con 16 (+3) x5 = +15 -> 43
  expect(maxHull(ship({ con: 16 }), ref)).toBe(43);
  expect(maxHull(ship({ con: 10 }), ref)).toBe(28);
  // A punishing Con can never drive max hull below zero.
  expect(maxHull(ship({ con: 1 }), ref)).toBe(3);   // 28 + (-5 * 5) = 3
});

test('max shields need a shield generator and scale by its capacity coefficient', () => {
  // No generator installed -> no shields at all.
  expect(maxShields(ship({ str: 16 }), ref)).toBe(0);
  // base = diceTotal(8,5) + str mod * 5 = 28 + 15 = 43
  expect(maxShields(ship({ str: 16, install: [['directional', 'shield']] }), ref)).toBe(43);
  // round(43 * 1.5) = round(64.5) = 65 (rounds, not floors -> not 64)
  expect(maxShields(ship({ str: 16, install: [['fortress', 'shield']] }), ref)).toBe(65);
  // round(43 * 0.667) = round(28.681) = 29 (rounds, not floors -> not 28)
  expect(maxShields(ship({ str: 16, install: [['quick', 'shield']] }), ref)).toBe(29);
});

test('shield regen is the max shield die value scaled by the regen coefficient', () => {
  expect(shieldRegen(ship(), ref)).toBe(0);                                        // no generator
  expect(shieldRegen(ship({ install: [['directional', 'shield']] }), ref)).toBe(8); // round(8 * 1) = 8
  expect(shieldRegen(ship({ install: [['fortress', 'shield']] }), ref)).toBe(5);    // round(8 * 0.667) = round(5.336) = 5
  expect(shieldRegen(ship({ install: [['quick', 'shield']] }), ref)).toBe(12);      // round(8 * 1.5) = 12
  // Rounding mode pin: on a d4 shield die, round and floor genuinely disagree.
  // round(4 * 0.667) = round(2.668) = 3 -- floor would give 2. No min-1 floor
  // either (that only mattered for the old floor-based formula).
  expect(shieldRegen(ship({ size: 'sm', install: [['fortress', 'shield']] }), ref)).toBe(3);
});

test('an unknown size yields zeroes rather than NaN', () => {
  const b = emptyShipBuild('Nowhere');
  expect(maxHull(b, ref)).toBe(0);
  expect(maxShields(b, ref)).toBe(0);
  expect(shieldRegen(b, ref)).toBe(0);
  expect(shipArmorClass(b, ref)).toBe(10);
});
