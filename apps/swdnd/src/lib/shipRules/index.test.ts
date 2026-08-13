// apps/swdnd/src/lib/shipRules/index.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type RefShipArmor, type RefShipModification, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './types';
import { OVERRIDABLE_SHIP, computeShip } from './index';

const medium: RefShipSize = {
  id: 'med', name: 'Medium Starship', key: 'medium',
  hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5, modBaseCap: 30,
  modMaxSuitesBase: 3, modMaxSuitesMult: 1, description: '',
};
const armorRow = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});
const weaponRow = (over: Partial<RefShipWeapon> & { id: string }): RefShipWeapon => ({
  name: over.id, category: 'primary', damageParts: [], rangeNormal: null, rangeLong: null,
  saveAbility: '', reload: null, usesAmmo: false, ammoTypes: [], weaponSize: null,
  attackBonus: 0, price: null, description: '', ...over,
});
const modRow = (id: string, system: string): RefShipModification => ({
  id, name: id, system, grade: 0, prerequisite: null, freeSlot: false, freeSuite: false,
  baseCost: null, description: '',
});

const ref: ShipReferenceData = {
  sizes: { med: medium },
  armor: {
    deflect: armorRow({ id: 'deflect', dexCap: 2, damageReduction: 3 }),
    directional: armorRow({ id: 'directional', kind: 'shield', baseAc: 0, capacityCoefficient: 1, regenCoefficient: 1 }),
  },
  equipment: {},
  weapons: { laser: weaponRow({ id: 'laser', name: 'Twin laser cannon', damageParts: [['1d8 + @mod', 'energy']] }) },
  modifications: { scrambler: modRow('scrambler', 'Engineering'), lounge: modRow('lounge', 'Suite') },
  deployments: {}, deploymentFeatures: {},
};

function ghost() {
  const b = emptyShipBuild('Ghost');
  b.identity = { name: 'Ghost', sizeId: 'med', tier: 2 };
  b.abilities.base = { str: 14, dex: 16, con: 14, int: 10, wis: 16, cha: 8 };
  b.equipment = [
    { id: 'a1', ref: 'deflect', kind: 'armor' },
    { id: 's1', ref: 'directional', kind: 'shield' },
    { id: 'w1', ref: 'laser', kind: 'weapon', mount: 'turret' },
    { id: 'w2', ref: 'laser', kind: 'weapon', mount: 'fixed-forward' },
  ];
  b.modifications = ['scrambler', 'lounge'];
  return b;
}

test('computeShip assembles the whole derived ship (Medium, tier 2)', () => {
  const d = computeShip(ghost(), ref);
  expect(d.tier).toBe(2);
  expect(d.abilities.dex).toEqual({ score: 16, mod: 3 });
  expect(d.armorClass).toBe(13);              // 10 + min(3, 2) + tier2 (+1)
  expect(d.damageReduction).toBe(3);
  expect(d.hullDice).toEqual({ die: 8, count: 7 });
  expect(d.maxHull).toBe(52);                 // diceTotal(8,7)=38 + con +2 * 7
  expect(d.shieldDice).toEqual({ die: 8, count: 7 });
  expect(d.maxShields).toBe(52);              // 38 + str +2 * 7, x1
  expect(d.shieldRegen).toBe(8);
  expect(d.speed).toBe(300);
  expect(d.turnSpeed).toBe(200);
  expect(d.rateOfFireCap).toBe(3);            // max(2,1) * 1.5 -> 3
  expect(d.weapons).toHaveLength(2);
  expect(d.weapons[0].attackText).toBe('+3 + your proficiency');
  expect(d.weapons[0].damageFormula).toBe('1d8 + 2');
});

test('budgets report usage against capacity', () => {
  const d = computeShip(ghost(), ref);
  expect(d.hardpointsUsed).toBe(2);
  expect(d.hardpointsMax).toBe(5);            // ceil(1.5 * 3)
  expect(d.modSlotsUsed).toBe(1);             // 'scrambler' — Suite mods do not consume a slot
  expect(d.modSlotsMax).toBe(3);              // tier 2 -> 3
  expect(d.suitesUsed).toBe(1);               // 'lounge'
  expect(d.suitesMax).toBe(5);                // 3 + 1*2
});

test('overrides replace exactly the five overridable scalars', () => {
  expect(OVERRIDABLE_SHIP).toEqual(['maxHull', 'maxShields', 'armorClass', 'speed', 'turnSpeed']);
  const b = ghost();
  b.overrides = { maxHull: 200, maxShields: 90, armorClass: 19, speed: 400, turnSpeed: 45 };
  const d = computeShip(b, ref);
  expect(d.maxHull).toBe(200);
  expect(d.maxShields).toBe(90);
  expect(d.armorClass).toBe(19);
  expect(d.speed).toBe(400);
  expect(d.turnSpeed).toBe(45);
  expect(d.shieldRegen).toBe(8);              // not overridable — untouched
  expect(d.damageReduction).toBe(3);
});

test('a brand new build computes cleanly with no size chosen', () => {
  const d = computeShip(emptyShipBuild('New'), ref);
  expect(d).toMatchObject({
    tier: 0, armorClass: 10, damageReduction: 0, maxHull: 0, maxShields: 0,
    shieldRegen: 0, speed: 0, turnSpeed: 0, hardpointsUsed: 0, hardpointsMax: 0,
    modSlotsUsed: 0, modSlotsMax: 1, suitesUsed: 0, suitesMax: 0,
  });
  expect(d.weapons).toEqual([]);
});

test('computeShip threads crew input into weapons and exposes the power profile', () => {
  const bare = computeShip(ghost(), ref);
  expect(bare.weapons[0].crewProficiencyApplied).toBe(false);
  expect(bare.power.die.label).toBeString();
  expect(bare.power.capacity).toBeDefined();

  const crewed = computeShip(ghost(), ref, { proficiencyByRole: { gunner: 3 } });
  expect(crewed.weapons[0].attackBonus).toBe(bare.weapons[0].attackBonus + 3);
  expect(crewed.weapons[0].saveDc).toBeNull();   // ghost's lasers are attack weapons
  expect(crewed.weapons[0].crewProficiencyApplied).toBe(true);
  // Crew never touches anything but the crew-dependent numbers.
  expect(crewed.armorClass).toBe(bare.armorClass);
  expect(crewed.maxHull).toBe(bare.maxHull);
  expect(crewed.power).toEqual(bare.power);
});
