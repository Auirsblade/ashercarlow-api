// apps/swdnd/src/lib/shipRules/integration.test.ts
// End-to-end: build a small starship through reducer actions only, then assert
// every derived number by hand math. Mirrors lib/rules/integration.test.ts.
import { expect, test } from 'bun:test';
import { applyShipBuildAction, type ShipBuildAction } from '../shipBuildState';
import { applyShipPlayAction } from '../shipPlayState';
import { shipStepStatus } from '../shipValidation';
import { computeShip } from './index';
import { emptyShipBuild, type RefShipArmor, type RefShipEquipment, type RefShipModification, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './types';

const small: RefShipSize = {
  id: 'sm', name: 'Small Starship', key: 'small',
  hullDie: 6, hullDiceStart: 3, shieldDie: 6, shieldDiceStart: 3,
  spaceSpeed: 300, turnSpeed: 250, hardpointMult: 1, modBaseCap: 20,
  modMaxSuitesBase: -1, modMaxSuitesMult: 1, description: '',
};
const armorRow = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});
const ref: ShipReferenceData = {
  sizes: { sm: small },
  armor: {
    deflect: armorRow({ id: 'deflect', name: 'Deflection Armor', dexCap: 2, damageReduction: 3 }),
    fortress: armorRow({ id: 'fortress', name: 'Fortress Shield', kind: 'shield', baseAc: 0, capacityCoefficient: 1.5, regenCoefficient: 0.667 }),
  },
  equipment: {
    fusial: {
      id: 'fusial', name: 'Fusial Reactor', kind: 'reactor', powerDiceRecovery: '1d4',
      hyperdriveClass: null, centralCapacity: null, systemCapacity: null, price: null, description: '',
    } satisfies RefShipEquipment,
    coaxium: {
      id: 'coaxium', name: 'Coaxium Coupling', kind: 'coupling', powerDiceRecovery: null,
      hyperdriveClass: null, centralCapacity: 4, systemCapacity: 2, price: null, description: '',
    } satisfies RefShipEquipment,
  },
  weapons: {
    laser: {
      id: 'laser', name: 'Twin laser cannon', category: 'primary',
      damageParts: [['1d8 + @mod', 'energy']], rangeNormal: 600, rangeLong: 2400,
      saveAbility: '', reload: null, usesAmmo: false, ammoTypes: [], weaponSize: 'Small',
      attackBonus: 0, price: null, description: '',
    } satisfies RefShipWeapon,
    torp: {
      id: 'torp', name: 'Torpedo tube', category: 'tertiary',
      damageParts: [['6d6', 'kinetic']], rangeNormal: 1200, rangeLong: null,
      saveAbility: 'dex', reload: 2, usesAmmo: true, ammoTypes: ['sstorpedo'], weaponSize: 'Small',
      attackBonus: 0, price: null, description: '',
    } satisfies RefShipWeapon,
  },
  modifications: {
    scrambler: { id: 'scrambler', name: 'EM Scrambler', system: 'Engineering', grade: 1, prerequisite: null, freeSlot: false, freeSuite: false, baseCost: 3500, description: '' } satisfies RefShipModification,
  },
};

function build(...actions: ShipBuildAction[]) {
  return actions.reduce(
    (acc, a) => applyShipBuildAction(acc, ref, computeShip(acc, ref), a),
    emptyShipBuild('Kestrel'),
  );
}

test('a Small tier-2 fighter, assembled through actions, computes every stat', () => {
  const b = build(
    { t: 'setSize', sizeId: 'sm' },
    { t: 'setBaseAbilities', base: { str: 14, dex: 18, con: 12, int: 10, wis: 16, cha: 8 } },
    { t: 'setTier', tier: 2 },
    { t: 'allocateTierPoint', tier: 1, ability: 'dex', delta: 1 },
    { t: 'allocateTierPoint', tier: 1, ability: 'wis', delta: 1 },
    { t: 'allocateTierPoint', tier: 2, ability: 'con', delta: 1 },
    { t: 'allocateTierPoint', tier: 2, ability: 'con', delta: 1 },
    { t: 'installEquipment', ref: 'deflect', kind: 'armor', id: 'a1' },
    { t: 'installEquipment', ref: 'fortress', kind: 'shield', id: 's1' },
    { t: 'installEquipment', ref: 'fusial', kind: 'reactor', id: 'r1' },
    { t: 'installEquipment', ref: 'coaxium', kind: 'coupling', id: 'c1' },
    { t: 'installEquipment', ref: 'laser', kind: 'weapon', mount: 'fixed-forward', id: 'w1' },
    { t: 'installEquipment', ref: 'torp', kind: 'weapon', mount: 'turret', id: 'w2' },
    { t: 'toggleModification', ref: 'scrambler' },
  );
  const d = computeShip(b, ref);

  // Abilities: str 14 (+2), dex 18+1=19 (+4), con 12+2=14 (+2), wis 16+1=17 (+3)
  expect(d.abilities).toMatchObject({
    str: { score: 14, mod: 2 }, dex: { score: 19, mod: 4 },
    con: { score: 14, mod: 2 }, wis: { score: 17, mod: 3 },
  });
  expect(d.tier).toBe(2);

  // AC = 10 (Deflection base) + min(dex +4, cap 2) + tier-2 bonus +1 = 13
  // (the Fortress shield's baseAc 0 never enters this: installedArmor only
  // reads kind==='armor' rows, so a shield generator can't contribute to AC.)
  expect(d.armorClass).toBe(13);
  expect(d.damageReduction).toBe(3);

  // Hull: d6, start 3 + tier 2 = 5 dice (small: +1 die/tier, not the
  // huge/gargantuan +2) -> 6 + 4*4 = 22; con +2 * 5 = +10 -> 32
  expect(d.hullDice).toEqual({ die: 6, count: 5 });
  expect(d.maxHull).toBe(32);

  // Shields: same 5 d6 -> 22 base + str +2 * 5 = 32; Fortress x1.5 -> Math.round(48) = 48
  expect(d.shieldDice).toEqual({ die: 6, count: 5 });
  expect(d.maxShields).toBe(48);
  // Regen: max shield die 6 x 0.667 -> Math.round(4.002) = 4
  expect(d.shieldRegen).toBe(4);

  expect(d.speed).toBe(300);
  expect(d.turnSpeed).toBe(250);
  // Rate of fire: max(str +2, 1) x small multiplier 1 = 2
  expect(d.rateOfFireCap).toBe(2);

  // Budgets: hardpoints ceil(1 * 3) = 3, mod slots tier+1 = 3, suites max(0, -1 + 1*2) = 1
  expect(d).toMatchObject({
    hardpointsUsed: 2, hardpointsMax: 3,
    modSlotsUsed: 1, modSlotsMax: 3,
    suitesUsed: 0, suitesMax: 1,
  });

  // Weapons: attack = wis +3 (+ literal proficiency suffix); damage adds str +2.
  // Both installed weapons are category 'primary'/'tertiary' — neither is the
  // pack's non-installable 'other' category, so both survive the profile filter.
  expect(d.weapons).toHaveLength(2);
  expect(d.weapons[0]).toMatchObject({
    entryId: 'w1', name: 'Twin laser cannon', mount: 'fixed-forward',
    attackShipMod: 3, attackText: '+3 + your proficiency',
    damageFormula: '1d8 + 2', damageType: 'energy',
    rangeNormal: 600, rangeLong: 2400, saveDc: null, usesAmmo: false,
  });
  expect(d.weapons[1]).toMatchObject({
    entryId: 'w2', name: 'Torpedo tube', mount: 'turret', category: 'tertiary',
    damageFormula: '6d6', saveAbility: 'dex', saveDc: 11, usesAmmo: true, reload: 2,
  });

  // Every builder step reads done at this point.
  const status = shipStepStatus(b, ref, d);
  expect(status.size.state).toBe('done');
  expect(status.tier).toMatchObject({ state: 'done', summary: 'tier 2' });
  expect(status.hull).toMatchObject({ state: 'done', summary: 'hull 32 · shields 48' });
  expect(status.weapons).toMatchObject({ state: 'done', summary: '2/3 hardpoints' });
  // equipment reports the reactor/hyperdrive/coupling layer, not hull/shields (that's status.hull's job above).
  expect(status.equipment).toMatchObject({ state: 'done', summary: 'Fusial Reactor · Coaxium Coupling' });
  expect(status.modifications).toMatchObject({ state: 'done', summary: '1/3 slots · suite 0/1' });
});

test('play actions move the two pools against the computed maxima', () => {
  let b = build(
    { t: 'setSize', sizeId: 'sm' },
    { t: 'setBaseAbilities', base: { str: 14, dex: 18, con: 12, int: 10, wis: 16, cha: 8 } },
    { t: 'setTier', tier: 2 },
    { t: 'installEquipment', ref: 'fortress', kind: 'shield', id: 's1' },
    { t: 'installEquipment', ref: 'torp', kind: 'weapon', id: 'w2' },
  );
  const d = computeShip(b, ref);           // maxHull: 5d6=22 + con +1 * 5 = 27; maxShields 48
  b = { ...b, play: { ...b.play, hull: d.maxHull, shields: d.maxShields } };

  const step = (a: Parameters<typeof applyShipPlayAction>[2]) => {
    b = { ...b, play: applyShipPlayAction(b, d, a) };
    return b.play;
  };

  expect(step({ t: 'damage', n: 10 })).toMatchObject({ shields: d.maxShields - 10, hull: d.maxHull });
  expect(step({ t: 'damage', n: 1000 })).toMatchObject({ shields: 0, hull: 0 });
  expect(step({ t: 'restoreShields', n: d.shieldRegen }).shields).toBe(d.shieldRegen);
  expect(step({ t: 'repairHull', n: 6 }).hull).toBe(6);
  expect(step({ t: 'spendAmmo', entryId: 'w2', n: 1 }).ammoSpent).toEqual({ w2: 1 });
  expect(step({ t: 'addCondition', c: 'Slowed 2' }).conditions).toEqual(['Slowed 2']);
  expect(step({ t: 'addCondition', c: 'Slowed 4' }).conditions).toEqual(['Slowed 4']);
  expect(step({ t: 'setSystemDamage', n: 3 }).systemDamage).toBe(3);
});
