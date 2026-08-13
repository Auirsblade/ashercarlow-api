// apps/swdnd/src/lib/starships.test.ts
import { expect, test } from 'bun:test';
import {
  mapShipArmorRow, mapShipEquipmentRow, mapShipModRow, mapShipSizeRow, mapShipWeaponRow,
} from './starships';

test('mapShipSizeRow pulls dice, speeds and budget inputs (Medium, verbatim from the pack)', () => {
  const row = {
    id: '6liD1m4hqKSeS5sp', name: 'Medium Starship',
    raw_json: JSON.stringify({ system: {
      identifier: 'medium', hullDice: 'd8', hullDiceStart: 5, shldDice: 'd8', shldDiceStart: 5,
      baseSpaceSpeed: 300, baseTurnSpeed: 200, hardpointMult: 1.5,
      modBaseCap: 30, modMaxSuitesBase: 3, modMaxSuitesMult: 1,
      description: { value: '<p>Bread and butter.</p>' },
    } }),
  };
  expect(mapShipSizeRow(row)).toMatchObject({
    id: '6liD1m4hqKSeS5sp', name: 'Medium Starship', key: 'medium',
    hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
    spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5,
    modBaseCap: 30, modMaxSuitesBase: 3, modMaxSuitesMult: 1,
  });
  expect(mapShipSizeRow(row).description).toContain('Bread and butter.');
});

// Carry-forward guard (Task 9 review): `key` MUST derive from `system.identifier`
// (the long form), never from `system.size` (the short code: tiny/sm/med/lg/huge/grg).
// shipRules/constants.ts's diceGrowthPerTier checks `size.key === 'huge' ||
// 'gargantuan'` — mapping from the short-code field would silently revert
// Gargantuan ships to 1 die/tier with no type error. Fixture verbatim from the
// real pack row (id FH8iBT4uujRUR0j7, "Gargantuan Starship").
test('mapShipSizeRow derives key from system.identifier, not the system.size short code', () => {
  const row = {
    id: 'FH8iBT4uujRUR0j7', name: 'Gargantuan Starship',
    raw_json: JSON.stringify({ system: {
      identifier: 'gargantuan', size: 'grg',
      hullDice: 'd20', hullDiceStart: 11, shldDice: 'd20', shldDiceStart: 11,
      baseSpaceSpeed: 300, baseTurnSpeed: 50, hardpointMult: 3,
      modBaseCap: 70, modMaxSuitesBase: 10, modMaxSuitesMult: 4,
    } }),
  };
  expect(mapShipSizeRow(row).key).toBe('gargantuan');
});

test('mapShipArmorRow reads AC, Dex cap and damage reduction for armor', () => {
  const deflection = {
    id: 'aG6mKPerYCFmkI00', name: 'Deflection Armor',
    raw_json: JSON.stringify({ system: {
      armor: { value: 10, type: 'starship', dex: 2 },
      attributes: { capx: { value: null }, dmgred: { value: 3 }, regrateco: { value: null } },
      price: { value: 3450 },
    } }),
  };
  expect(mapShipArmorRow(deflection)).toMatchObject({
    kind: 'armor', baseAc: 10, dexCap: 2, damageReduction: 3,
    capacityCoefficient: null, regenCoefficient: null, price: 3450,
  });
  const lightweight = { id: 'l', name: 'Lightweight Armor', raw_json: JSON.stringify({ system: {
    armor: { value: 10, type: 'starship', dex: null },
    attributes: { dmgred: { value: 0 } },
  } }) };
  expect(mapShipArmorRow(lightweight).dexCap).toBeNull();
  const reinforced = { id: 'r', name: 'Reinforced Armor', raw_json: JSON.stringify({ system: {
    armor: { value: 10, type: 'starship', dex: 0 },
    attributes: { dmgred: { value: 6 } },
  } }) };
  expect(mapShipArmorRow(reinforced)).toMatchObject({ dexCap: 0, damageReduction: 6 });
});

test('mapShipArmorRow classifies ssshield rows and reads both coefficients', () => {
  const fortress = { id: 'Wj62TEtwKeG1P2DD', name: 'Fortress Shield', raw_json: JSON.stringify({ system: {
    armor: { value: 0, type: 'ssshield', dex: null },
    attributes: { capx: { value: 1.5 }, dmgred: { value: null }, regrateco: { value: 0.667 } },
  } }) };
  expect(mapShipArmorRow(fortress)).toMatchObject({
    kind: 'shield', capacityCoefficient: 1.5, regenCoefficient: 0.667, damageReduction: 0,
  });
  const quick = { id: 'q', name: 'Quick-Charge Shield', raw_json: JSON.stringify({ system: {
    armor: { value: 0, type: 'ssshield', dex: null },
    attributes: { capx: { value: 0.667 }, regrateco: { value: 1.5 } },
  } }) };
  expect(mapShipArmorRow(quick)).toMatchObject({ capacityCoefficient: 0.667, regenCoefficient: 1.5 });
});

test('mapShipEquipmentRow discriminates reactors, hyperdrives and couplings', () => {
  const reactor = { id: 'UAiau5ZNXVJAJFUn', name: 'Power Core Reactor', raw_json: JSON.stringify({ system: {
    armor: { value: null, type: 'reactor', dex: null },
    attributes: { powerdicerec: { value: '1d2' }, hdclass: { value: null }, cscap: { value: null }, sscap: { value: null } },
    price: { value: 5750 },
  } }) };
  expect(mapShipEquipmentRow(reactor)).toMatchObject({ kind: 'reactor', powerDiceRecovery: '1d2', price: 5750 });

  const hyper = { id: 'h', name: 'Hyperdrive, Class 2', raw_json: JSON.stringify({ system: {
    armor: { type: 'hyper' }, attributes: { hdclass: { value: 2 } },
  } }) };
  expect(mapShipEquipmentRow(hyper)).toMatchObject({ kind: 'hyperdrive', hyperdriveClass: 2 });

  const coupling = { id: 'c', name: 'Direct Power Coupling', raw_json: JSON.stringify({ system: {
    armor: { type: 'powerc' }, attributes: { cscap: { value: 4 }, sscap: { value: 0 } },
  } }) };
  expect(mapShipEquipmentRow(coupling)).toMatchObject({ kind: 'coupling', centralCapacity: 4, systemCapacity: 0 });
});

test('mapShipWeaponRow normalises the category, ranges, save and ammo flags', () => {
  const laser = { id: 'sHKo4DKkCRTMJwVK', name: 'Twin laser cannon', raw_json: JSON.stringify({ system: {
    weaponType: 'primary (starship)', weaponSize: 'Small',
    damage: { parts: [['1d8 + @mod', 'energy']] },
    range: { value: 600, long: 2400, units: 'ft' },
    save: { ability: '', dc: null, scaling: 'power' },
    ammo: { types: [] }, attackBonus: '0',
    properties: { amm: false, rel: null },
  } }) };
  expect(mapShipWeaponRow(laser)).toMatchObject({
    category: 'primary', weaponSize: 'Small', rangeNormal: 600, rangeLong: 2400,
    saveAbility: '', usesAmmo: false, reload: null, attackBonus: 0,
    damageParts: [['1d8 + @mod', 'energy']],
  });

  const bomb = { id: 'b', name: 'Bomb deployer', raw_json: JSON.stringify({ system: {
    weaponType: 'quaternary (starship)',
    damage: { parts: [['0d0 + @mod', '-']] },
    range: { value: null, long: null },
    ammo: { types: ['ssbomb'] }, save: null, attackBonus: 0,
    properties: { amm: true, rel: 4 },
  } }) };
  expect(mapShipWeaponRow(bomb)).toMatchObject({
    category: 'quaternary', usesAmmo: true, reload: 4, ammoTypes: ['ssbomb'], weaponSize: null,
  });

  // "ammo" and "simpleVW" rows are not installable weapons.
  const ammoRow = { id: 'a', name: 'Proton torpedo', raw_json: JSON.stringify({ system: { weaponType: 'ammo' } }) };
  expect(mapShipWeaponRow(ammoRow).category).toBe('other');

  const ion = { id: 'i', name: 'Ion battery', raw_json: JSON.stringify({ system: {
    weaponType: 'secondary (starship)', save: { ability: 'con', dc: 13, scaling: 'flat' },
  } }) };
  expect(mapShipWeaponRow(ion)).toMatchObject({ category: 'secondary', saveAbility: 'con' });
});

test('mapShipModRow unwraps the {value} envelopes', () => {
  const row = { id: '3MZVUSBNH9B36Sx7', name: 'Electromagnetic Scrambler, Mk IV', raw_json: JSON.stringify({ system: {
    system: { value: 'Engineering' }, grade: { value: 4 },
    prerequisites: { value: 'Electromagnetic Scrambler, Mk III' },
    free: { slot: false, suite: false }, basecost: { value: 3500 },
    description: { value: '<p>Scrambles.</p>' },
  } }) };
  expect(mapShipModRow(row)).toMatchObject({
    system: 'Engineering', grade: 4, prerequisite: 'Electromagnetic Scrambler, Mk III',
    freeSlot: false, freeSuite: false, baseCost: 3500,
  });
  const bare = { id: 'x', name: 'X', raw_json: JSON.stringify({ system: {
    system: { value: 'Suite' }, grade: { value: null }, prerequisites: { value: '' }, free: { slot: true, suite: true },
  } }) };
  expect(mapShipModRow(bare)).toMatchObject({ system: 'Suite', grade: 0, prerequisite: null, freeSlot: true, freeSuite: true });
});
