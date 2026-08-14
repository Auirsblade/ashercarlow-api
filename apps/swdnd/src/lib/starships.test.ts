// apps/swdnd/src/lib/starships.test.ts
import { describe, expect, it, test } from 'bun:test';
import {
  createShipFromBuild, fillStockPlay, filterStockShips, mapDeploymentFeatureRow, mapDeploymentRow, mapShipArmorRow,
  mapShipEquipmentRow, mapShipModRow, mapShipSizeRow, mapShipWeaponRow, parseStockShip, resolveRef,
  ShipBuildPatchError, sourceRef, stockShipSizes, stockToShipBuild,
  type ShipRefIndex, type StockShipItem, type StockShipRow, type StockShipView,
} from './starships';
import { emptyShipBuild } from './shipRules/types';

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

// modMaxSuitesBase is legitimately -1 on Small (see the comment on the
// mapper) — assert it explicitly so a future `|| 0` regression fails loudly.
// Fixture verbatim from the real pack row (id 6BN8l5E8QtYt103T, "Small Starship").
test('mapShipSizeRow preserves a negative modMaxSuitesBase (Small, verbatim from the pack)', () => {
  const row = {
    id: '6BN8l5E8QtYt103T', name: 'Small Starship',
    raw_json: JSON.stringify({ system: {
      identifier: 'small', hullDice: 'd6', hullDiceStart: 3, shldDice: 'd6', shldDiceStart: 3,
      baseSpaceSpeed: 300, baseTurnSpeed: 250, hardpointMult: 1,
      modBaseCap: 20, modMaxSuitesBase: -1, modMaxSuitesMult: 1,
    } }),
  };
  expect(mapShipSizeRow(row).modMaxSuitesBase).toBe(-1);
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
  // Every real ssshield row stores armor.value: 0 — assert it explicitly. A
  // `Number(v ?? 10) || 10` fallback would coerce this legit 0 to 10 and give
  // every shielded ship +10 AC downstream.
  expect(mapShipArmorRow(fortress)).toMatchObject({
    kind: 'shield', baseAc: 0, capacityCoefficient: 1.5, regenCoefficient: 0.667, damageReduction: 0,
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
  expect(mapShipWeaponRow(ion)).toMatchObject({ category: 'secondary', saveAbility: 'con', saveDc: 13 });
});

// Fixture verbatim from the real pack row (heavy-ion-cannon.json): a
// flat-scaling save weapon prints its own DC rather than deriving one from
// the ship's WIS -- the mapper must preserve it, not drop it on the floor.
test('mapShipWeaponRow reads an explicit save.dc off a flat-scaling ion cannon', () => {
  const heavyIon = { id: 'hic', name: 'Heavy ion cannon', raw_json: JSON.stringify({ system: {
    weaponType: 'primary (starship)',
    damage: { parts: [['1d10 + @mod + (@strmod/2)', 'ion']] },
    range: { value: 300, long: 1200 },
    save: { ability: 'con', dc: 13, scaling: 'flat' },
    ammo: { types: [] }, attackBonus: 0,
    properties: { amm: false },
  } }) };
  expect(mapShipWeaponRow(heavyIon)).toMatchObject({ category: 'primary', saveAbility: 'con', saveDc: 13 });
});

// A power-scaling save weapon (the common case) omits dc entirely -- the
// mapper must fall through to null, not coerce a missing/null dc to 0 (which
// would read as a DC-0 save downstream instead of "no pack override").
test('mapShipWeaponRow maps a null/absent save.dc to null, not 0', () => {
  const laser = { id: 'l2', name: 'Laser cannon', raw_json: JSON.stringify({ system: {
    weaponType: 'primary (starship)', save: { ability: '', dc: null, scaling: 'power' },
  } }) };
  expect(mapShipWeaponRow(laser).saveDc).toBeNull();
});

// Real launchers (Assault rocket pod launcher, Rocket pod launcher) omit
// `properties.amm` entirely — it's undefined, not false — even though both
// carry ammo.types and a reload value. `usesAmmo` must fall back to
// `ammoTypes.length > 0` or these silently read as ammo-less. Fixture
// verbatim from the real pack row (id AnrF720ut7gCd87W, "Rocket pod launcher").
test('mapShipWeaponRow infers usesAmmo from ammoTypes when properties.amm is absent', () => {
  const rocketPod = { id: 'AnrF720ut7gCd87W', name: 'Rocket pod launcher', raw_json: JSON.stringify({ system: {
    weaponType: 'tertiary (starship)',
    damage: { parts: [['0d0 + @mod', '']] },
    range: { value: null, long: null },
    ammo: { target: '', value: null, use: null, types: ['ssmissile'] },
    save: { ability: '', dc: null, scaling: 'power' },
    attackBonus: '',
    properties: { rel: 12, aut: false, spc: true },
  } }) };
  expect(mapShipWeaponRow(rocketPod)).toMatchObject({
    category: 'tertiary', usesAmmo: true, reload: 12, ammoTypes: ['ssmissile'],
  });
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

test('mapDeploymentRow derives the role key from the row name', () => {
  const row = {
    id: '8B0449FqtXP02WVs', name: 'Gunner',
    raw_json: JSON.stringify({ system: { description: { value: '<p>Guns &amp; more guns.</p>' } } }),
  };
  const d = mapDeploymentRow(row);
  expect(d).toMatchObject({ id: '8B0449FqtXP02WVs', name: 'Gunner', role: 'gunner' });
  expect(d.description).toContain('Guns & more guns.');
  // A row whose name is not one of the six SotG deployments has no role.
  expect(mapDeploymentRow({ id: 'x', name: 'Quartermaster', raw_json: '{}' }).role).toBeNull();
});

test('mapDeploymentFeatureRow parses role, rank, power-die location and activation', () => {
  const row = {
    id: 'dSMbwvdqRmrHWvwl', name: 'Angle Deflector Shields',
    raw_json: JSON.stringify({
      system: {
        requirements: 'Technician 1st Rank',
        activation: { type: 'reaction', cost: 1, condition: '' },
        consume: { type: 'powerdice', target: 'attributes.power.shields.value', amount: 1 },
        description: { value: '<p>Reduce the damage absorbed by your shields.</p>' },
      },
    }),
  };
  const f = mapDeploymentFeatureRow(row);
  expect(f).toMatchObject({
    id: 'dSMbwvdqRmrHWvwl', name: 'Angle Deflector Shields',
    role: 'technician', rank: 1, powerSystem: 'shields', activation: 'reaction',
  });
  expect(f.description).toContain('Reduce the damage absorbed by your shields.');
});

test('mapDeploymentFeatureRow handles every rank ordinal and the Universal outlier', () => {
  const at = (requirements: string) =>
    mapDeploymentFeatureRow({ id: 'r', name: 'R', raw_json: JSON.stringify({ system: { requirements } }) });
  expect(at('Gunner 2nd Rank')).toMatchObject({ role: 'gunner', rank: 2 });
  expect(at('Pilot 3rd Rank')).toMatchObject({ role: 'pilot', rank: 3 });
  expect(at('Operator 4th Rank')).toMatchObject({ role: 'operator', rank: 4 });
  expect(at('Mechanic 5th Rank')).toMatchObject({ role: 'mechanic', rank: 5 });
  expect(at('Universal 1st Rank')).toMatchObject({ role: 'universal', rank: 1 });
  // Unparseable requirements fall into the universal bucket at rank 0 (always visible).
  expect(at('')).toMatchObject({ role: 'universal', rank: 0 });
});

test('mapDeploymentFeatureRow leaves powerSystem null when nothing is consumed', () => {
  const row = {
    id: 'f', name: 'F',
    raw_json: JSON.stringify({
      system: { requirements: 'Pilot 1st Rank', consume: { type: '', target: '', amount: null } },
    }),
  };
  expect(mapDeploymentFeatureRow(row)).toMatchObject({ powerSystem: null, activation: '' });
});

// ---- Stock ships (drakes-shipyard pack) ----

const shuttleRaw = JSON.stringify({
  _id: 'tRnGAAILKowm8n4T',
  name: "Aka'jor-class Shuttle",
  type: 'starship',
  system: {
    abilities: { str: { value: 13 }, dex: { value: 14 }, con: { value: 13 }, int: { value: 8 }, wis: { value: 12 }, cha: { value: 14 } },
    attributes: {
      ac: { flat: null, calc: 'starship' },
      hp: { value: 27, max: 27, temp: 18, tempmax: 18 },
      movement: { walk: 30, fly: 0, space: 0, turn: 0, units: 'ft' },
      systemDamage: 0,
    },
    details: { source: "Drake's Shipyard", tier: '2', role: [] },
    traits: { size: null },
  },
  items: [
    { _id: 'i1', name: 'Small Starship', type: 'starshipsize', flags: { core: { sourceId: 'Compendium.sw5e.starships.6BN8l5E8QtYt103T' } }, system: { tier: 2, size: 'sm' } },
    { _id: 'i2', name: 'Deflection Armor', type: 'equipment', flags: { core: { sourceId: 'Compendium.sw5e.starshiparmor.aG6mKPerYCFmkI00' } }, system: { armor: { value: 10, type: 'starship', dex: 2 }, quantity: 1 } },
    { _id: 'i3', name: 'Quick-Charge Shield', type: 'equipment', flags: { core: { sourceId: 'Compendium.sw5e.starshiparmor.M7igMGsBIosGA4dS' } }, system: { armor: { value: 0, type: 'ssshield', dex: null }, quantity: 1 } },
    { _id: 'i4', name: 'Fuel Cell Reactor', type: 'equipment', flags: { core: { sourceId: 'Compendium.sw5e.starshipequipment.jk7zL3cqhufDKsuh' } }, system: { armor: { value: null, type: 'reactor', dex: null } } },
    { _id: 'i5', name: 'Hyperdrive, Class 1.5', type: 'equipment', flags: { core: { sourceId: 'Compendium.sw5e.starshipequipment.EllirPMc7jJSHZpL' } }, system: { armor: { value: null, type: 'hyper', dex: null } } },
    { _id: 'i6', name: 'Heavy blaster cannon', type: 'weapon', flags: { core: { sourceId: 'Compendium.sw5e.starshipweapons.A0LPvkVHhH3e2Aeh' } }, system: { weaponType: 'primary (starship)', mountType: null, quantity: 1 } },
    { _id: 'i7', name: 'Adaptive Ailerons', type: 'starshipmod', flags: { core: { sourceId: 'Compendium.sw5e.starshipmodifications.H1PmkigBok9ThtyJ' } }, system: { quantity: 1, tier: 0 } },
    { _id: 'i8', name: 'Attack Run', type: 'feat', flags: { core: { sourceId: 'Compendium.sw5e.starshipactions.O9t2gB5wl6n86Eh4' } }, system: {} },
    { _id: 'i9', name: 'Proton torpedo', type: 'consumable', flags: { core: { sourceId: 'Compendium.sw5e.starshipweapons.sNop7QuAG9JwcZiG' } }, system: { quantity: 4 } },
  ],
});

const shuttleRow: StockShipRow = { id: 'tRnGAAILKowm8n4T', name: "Aka'jor-class Shuttle", raw_json: shuttleRaw };

const view = (over: Partial<StockShipView>): StockShipView => ({
  id: 'x', name: 'X', sizeRef: null, sizeName: 'Small Starship', tier: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  hull: 10, shields: 10, source: '', weapons: [], equipment: [], modifications: [], ...over,
});

describe('sourceRef', () => {
  it('extracts the reference id from a Foundry compendium path', () => {
    expect(sourceRef('Compendium.sw5e.starshipweapons.A0LPvkVHhH3e2Aeh')).toBe('A0LPvkVHhH3e2Aeh');
    expect(sourceRef('Compendium.sw5e.starships.6BN8l5E8QtYt103T')).toBe('6BN8l5E8QtYt103T');
  });
  it('returns null on anything else', () => {
    expect(sourceRef(undefined)).toBeNull();
    expect(sourceRef('')).toBeNull();
    expect(sourceRef('Compendium.sw5e.starships')).toBeNull();
    expect(sourceRef(42)).toBeNull();
  });
});

describe('parseStockShip', () => {
  it('reads identity, size, tier, abilities and pools', () => {
    const v = parseStockShip(shuttleRow);
    expect(v.id).toBe('tRnGAAILKowm8n4T');
    expect(v.name).toBe("Aka'jor-class Shuttle");
    expect(v.sizeRef).toBe('6BN8l5E8QtYt103T');
    expect(v.sizeName).toBe('Small Starship');   // system.traits.size is null on every pack ship
    expect(v.tier).toBe(2);                      // details.tier is the string '2'
    expect(v.abilities).toEqual({ str: 13, dex: 14, con: 13, int: 8, wis: 12, cha: 14 });
    expect(v.hull).toBe(27);                     // hp.max
    expect(v.shields).toBe(18);                  // hp.tempmax
    expect(v.source).toBe("Drake's Shipyard");
  });

  it('groups installed items by type and keeps their refs and kind discriminators', () => {
    const v = parseStockShip(shuttleRow);
    expect(v.weapons.map((w) => w.name)).toEqual(['Heavy blaster cannon']);
    expect(v.weapons[0].ref).toBe('A0LPvkVHhH3e2Aeh');
    expect(v.weapons[0].weaponType).toBe('primary (starship)');
    expect(v.equipment.map((e) => e.armorType)).toEqual(['starship', 'ssshield', 'reactor', 'hyper']);
    expect(v.equipment[1].ref).toBe('M7igMGsBIosGA4dS');
    expect(v.modifications.map((m) => m.name)).toEqual(['Adaptive Ailerons']);
    // feats (starship actions) and consumables (ammo) are not build entries
    expect(JSON.stringify(v)).not.toContain('Attack Run');
    expect(JSON.stringify(v)).not.toContain('Proton torpedo');
  });

  it('degrades instead of throwing on malformed rows', () => {
    const empty = parseStockShip({ id: 'zz', name: null, raw_json: 'not json' });
    expect(empty.name).toBe('zz');
    expect(empty.tier).toBe(0);
    expect(empty.sizeRef).toBeNull();
    expect(empty.sizeName).toBe('');
    expect(empty.hull).toBeNull();
    expect(empty.shields).toBeNull();
    expect(empty.abilities).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    expect(empty.weapons).toEqual([]);
  });

  it('falls back to hp.value/hp.temp when the pack omits the maxima (2 of 87 ships)', () => {
    const raw = JSON.parse(shuttleRaw);
    raw.system.attributes.hp = { value: 38, max: null, temp: null, tempmax: null };
    const v = parseStockShip({ id: 'bw', name: 'A/SF-01 B-wing starfighter', raw_json: JSON.stringify(raw) });
    expect(v.hull).toBe(38);
    expect(v.shields).toBeNull();
  });

  it('takes tier from the embedded size item when details.tier is absent', () => {
    const raw = JSON.parse(shuttleRaw);
    delete raw.system.details.tier;
    expect(parseStockShip({ id: 'a', name: 'A', raw_json: JSON.stringify(raw) }).tier).toBe(2);
  });
});

describe('filterStockShips / stockShipSizes', () => {
  const list = [
    view({ id: 'a', name: 'ARC-170 Starfighter', sizeName: 'Small Starship', tier: 2 }),
    view({ id: 'b', name: 'Acclamator-class Assault Ship', sizeName: 'Gargantuan Starship', tier: 5 }),
    view({ id: 'c', name: 'Amphibious Fighter', sizeName: 'Tiny Starship', tier: 0 }),
  ];

  it('matches names case-insensitively', () => {
    expect(filterStockShips(list, { q: 'arc' }).map((s) => s.id)).toEqual(['a']);
    expect(filterStockShips(list, { q: '  A  ' }).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
  it('filters by size and tier range', () => {
    expect(filterStockShips(list, { q: '', size: 'Tiny Starship' }).map((s) => s.id)).toEqual(['c']);
    expect(filterStockShips(list, { q: '', tierMin: 2 }).map((s) => s.id)).toEqual(['a', 'b']);
    expect(filterStockShips(list, { q: '', tierMax: 2 }).map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterStockShips(list, { q: '', tierMin: 2, tierMax: 2 }).map((s) => s.id)).toEqual(['a']);
  });
  it('lists the sizes present, in canonical order', () => {
    expect(stockShipSizes(list)).toEqual(['Tiny Starship', 'Small Starship', 'Gargantuan Starship']);
  });
});

// ---- Stock ship -> ShipBuild ----

const idx: ShipRefIndex = {
  sizes: { '6BN8l5E8QtYt103T': 'Small Starship', RFKvLuqE13INBxqd: 'Large Starship' },
  weapons: { A0LPvkVHhH3e2Aeh: 'Heavy blaster cannon', aT793quog1Rf5hjm: 'Rapid-fire laser cannon' },
  armor: { aG6mKPerYCFmkI00: 'Deflection Armor', M7igMGsBIosGA4dS: 'Quick-Charge Shield' },
  equipment: { jk7zL3cqhufDKsuh: 'Fuel Cell Reactor', oqB8RltTDjHnaS1Y: 'Direct Power Coupling', EllirPMc7jJSHZpL: 'Hyperdrive, Class 1.5' },
  modifications: { '6WjkUMegKn0XeCNz': 'Adaptive Ailerons', Th7e9A044Rao7Bhf: 'Co-Pilot Seat' },
};

const item = (over: Partial<StockShipItem>): StockShipItem =>
  ({ name: '', ref: null, armorType: '', weaponType: '', ...over });

const shuttleView: StockShipView = {
  id: 'tRnGAAILKowm8n4T',
  name: "Aka'jor-class Shuttle",
  sizeRef: '6BN8l5E8QtYt103T',
  sizeName: 'Small Starship',
  tier: 2,
  abilities: { str: 13, dex: 14, con: 13, int: 8, wis: 12, cha: 14 },
  hull: 27,
  shields: 18,
  source: "Drake's Shipyard",
  weapons: [item({ name: 'Heavy blaster cannon', ref: 'A0LPvkVHhH3e2Aeh', weaponType: 'primary (starship)' })],
  equipment: [
    item({ name: 'Deflection Armor', ref: 'aG6mKPerYCFmkI00', armorType: 'starship' }),
    item({ name: 'Quick-Charge Shield', ref: 'M7igMGsBIosGA4dS', armorType: 'ssshield' }),
    item({ name: 'Fuel Cell Reactor', ref: 'jk7zL3cqhufDKsuh', armorType: 'reactor' }),
    item({ name: 'Direct Power Coupling', ref: 'oqB8RltTDjHnaS1Y', armorType: 'powerc' }),
    item({ name: 'Hyperdrive, Class 1.5', ref: 'EllirPMc7jJSHZpL', armorType: 'hyper' }),
    item({ name: 'Lucky Dice', ref: null, armorType: 'trinket' }),   // no ShipBuild kind -> dropped
  ],
  modifications: [
    item({ name: 'Adaptive Ailerons', ref: 'H1PmkigBok9ThtyJ' }),   // stale id, resolvable by name
    item({ name: 'Co-Pilot Seat', ref: null }),                     // no sourceId at all
    item({ name: 'Nonexistent Widget', ref: 'zzzzzzzzzzzzzzzz' }),  // unresolvable -> dropped
  ],
};

describe('resolveRef', () => {
  it('prefers the id when it exists in the index', () => {
    expect(resolveRef(idx.weapons, 'A0LPvkVHhH3e2Aeh', 'anything')).toBe('A0LPvkVHhH3e2Aeh');
  });
  it('falls back to a case-insensitive name match (143 of 143 mod ids in the pack are stale)', () => {
    expect(resolveRef(idx.modifications, 'H1PmkigBok9ThtyJ', 'Adaptive Ailerons')).toBe('6WjkUMegKn0XeCNz');
    expect(resolveRef(idx.modifications, null, 'co-pilot seat')).toBe('Th7e9A044Rao7Bhf');
  });
  it('returns null when neither resolves', () => {
    expect(resolveRef(idx.modifications, 'nope', 'Nonexistent Widget')).toBeNull();
    expect(resolveRef(idx.modifications, null, '')).toBeNull();
  });
});

describe('stockToShipBuild', () => {
  const build = stockToShipBuild(shuttleView, idx);

  it('carries identity, size and tier at the current build schema version', () => {
    // Seeded from emptyShipBuild, so a stock ship is stamped with whatever
    // schemaVersion (and whatever later-added play fields) the empty document has.
    expect(build.schemaVersion).toBe(emptyShipBuild('x').schemaVersion);
    expect(build.identity).toEqual({ name: "Aka'jor-class Shuttle", sizeId: '6BN8l5E8QtYt103T', tier: 2 });
  });

  it('takes the published ability scores as the base, with no tier increases', () => {
    expect(build.abilities.base).toEqual({ str: 13, dex: 14, con: 13, int: 8, wis: 12, cha: 14 });
    expect(build.abilities.increases).toEqual([]);
  });

  it('installs weapons first with a fixed-forward default mount (the pack has no mountType)', () => {
    expect(build.equipment[0]).toEqual({ id: 'e1', ref: 'A0LPvkVHhH3e2Aeh', kind: 'weapon', mount: 'fixed-forward' });
  });

  it('maps equipment kinds from system.armor.type and drops what ShipBuild cannot model', () => {
    expect(build.equipment.slice(1)).toEqual([
      { id: 'e2', ref: 'aG6mKPerYCFmkI00', kind: 'armor' },
      { id: 'e3', ref: 'M7igMGsBIosGA4dS', kind: 'shield' },
      { id: 'e4', ref: 'jk7zL3cqhufDKsuh', kind: 'reactor' },
      { id: 'e5', ref: 'oqB8RltTDjHnaS1Y', kind: 'coupling' },
      { id: 'e6', ref: 'EllirPMc7jJSHZpL', kind: 'hyperdrive' },
    ]);
    expect(JSON.stringify(build.equipment)).not.toContain('Lucky Dice');   // trinket: no ShipBuild kind
    expect(build.equipment).toHaveLength(6);
  });

  it('resolves modifications by id-then-name and drops the unresolvable', () => {
    expect(build.modifications).toEqual(['6WjkUMegKn0XeCNz', 'Th7e9A044Rao7Bhf']);
  });

  it('pins the published hull/shield totals as overrides and starts the ship at full', () => {
    expect(build.overrides).toEqual({ maxHull: 27, maxShields: 18 });
    expect(build.play.hull).toBe(27);
    expect(build.play.shields).toBe(18);
    expect(build.play.systemDamage).toBe(0);
    expect(build.play.conditions).toEqual([]);
    expect(build.play.ammoSpent).toEqual({});
    expect(build.play.notes).toBe("Stock: Aka'jor-class Shuttle (Drake's Shipyard)");
  });

  it('omits an override the pack did not publish', () => {
    const noMax = stockToShipBuild({ ...shuttleView, hull: 38, shields: null }, idx);
    expect(noMax.overrides).toEqual({ maxHull: 38 });
    expect(noMax.play.shields).toBe(0);
  });

  it('falls back to a name match for the size when the size ref is stale', () => {
    const b = stockToShipBuild({ ...shuttleView, sizeRef: 'stale' }, idx);
    expect(b.identity.sizeId).toBe('6BN8l5E8QtYt103T');
  });
});

describe('fillStockPlay', () => {
  it('tops up only the pools the pack left at zero', () => {
    const build = stockToShipBuild({ ...shuttleView, hull: null, shields: null }, idx);
    const filled = fillStockPlay(build, { maxHull: 21, maxShields: 15 });
    expect(filled.play.hull).toBe(21);
    expect(filled.play.shields).toBe(15);
    expect(filled.overrides).toEqual({});         // still derived, not pinned
  });
  it('leaves a published build untouched', () => {
    const build = stockToShipBuild(shuttleView, idx);
    expect(fillStockPlay(build, { maxHull: 999, maxShields: 999 })).toBe(build);
  });
});

describe('createShipFromBuild', () => {
  // No fetch-mocking helper exists elsewhere in this suite; swapping
  // globalThis.fetch for the duration of a test is the cheapest way to pin
  // which leg (POST vs PATCH) produced a given rejection.
  const withMockFetch = async (
    responses: Response[],
    run: () => Promise<unknown>,
  ): Promise<unknown> => {
    const original = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async () => responses[call++]) as typeof fetch;
    try {
      return await run().catch((e: unknown) => e);
    } finally {
      globalThis.fetch = original;
    }
  };

  const okResponse = () =>
    new Response(
      JSON.stringify({
        id: 's1', campaign_id: 'c1', name: 'Ship', data_json: emptyShipBuild('Ship'),
        created_at: '', updated_at: '', crew: [],
      }),
      { status: 200 },
    );
  const failResponse = (message: string) =>
    new Response(JSON.stringify({ message }), { status: 500 });

  it('tags a PATCH-leg failure with ShipBuildPatchError, carrying the original message', async () => {
    const err = await withMockFetch(
      [okResponse(), failResponse('patch boom')],
      () => createShipFromBuild('c1', emptyShipBuild('Ship')),
    );
    expect(err).toBeInstanceOf(ShipBuildPatchError);
    expect((err as Error).message).toBe('patch boom');
  });

  it('leaves a POST-leg failure untagged so the generic handler applies', async () => {
    const err = await withMockFetch(
      [failResponse('post boom')],
      () => createShipFromBuild('c1', emptyShipBuild('Ship')),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ShipBuildPatchError);
    expect((err as Error).message).toBe('post boom');
  });
});
