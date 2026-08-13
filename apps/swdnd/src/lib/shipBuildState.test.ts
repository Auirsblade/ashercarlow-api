// apps/swdnd/src/lib/shipBuildState.test.ts
import { expect, test } from 'bun:test';
import { computeShip } from './shipRules';
import { emptyShipBuild, type RefShipArmor, type RefShipModification, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './shipRules/types';
import { applyShipBuildAction, type ShipBuildAction } from './shipBuildState';

const medium: RefShipSize = {
  id: 'med', name: 'Medium Starship', key: 'medium',
  hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5, modBaseCap: 30,
  modMaxSuitesBase: 3, modMaxSuitesMult: 1, description: '',
};
const small: RefShipSize = { ...medium, id: 'sm', name: 'Small Starship', key: 'small', hullDie: 6, hullDiceStart: 3, shieldDie: 6, shieldDiceStart: 3, hardpointMult: 1, modMaxSuitesBase: -1 };
const armorRow = (over: Partial<RefShipArmor> & { id: string }): RefShipArmor => ({
  name: over.id, kind: 'armor', baseAc: 10, dexCap: null, damageReduction: 0,
  capacityCoefficient: null, regenCoefficient: null, price: null, description: '', ...over,
});
const weaponRow = (id: string): RefShipWeapon => ({
  id, name: id, category: 'primary', damageParts: [['1d8 + @mod', 'energy']],
  rangeNormal: null, rangeLong: null, saveAbility: '', reload: null, usesAmmo: false,
  ammoTypes: [], weaponSize: null, attackBonus: 0, price: null, description: '',
});
const modRow = (id: string, system: string): RefShipModification => ({
  id, name: id, system, grade: 0, prerequisite: null, freeSlot: false, freeSuite: false, baseCost: null, description: '',
});

const ref: ShipReferenceData = {
  sizes: { med: medium, sm: small },
  armor: {
    deflect: armorRow({ id: 'deflect', dexCap: 2, damageReduction: 3 }),
    reinf: armorRow({ id: 'reinf', dexCap: 0, damageReduction: 6 }),
    directional: armorRow({ id: 'directional', kind: 'shield', baseAc: 0, capacityCoefficient: 1, regenCoefficient: 1 }),
    fortress: armorRow({ id: 'fortress', kind: 'shield', baseAc: 0, capacityCoefficient: 1.5, regenCoefficient: 0.667 }),
  },
  equipment: {},
  weapons: { laser: weaponRow('laser'), ion: weaponRow('ion') },
  modifications: { scrambler: modRow('scrambler', 'Engineering'), lounge: modRow('lounge', 'Suite') },
};

const dispatch = (b = base(), ...actions: ShipBuildAction[]) =>
  actions.reduce((acc, a) => applyShipBuildAction(acc, ref, computeShip(acc, ref), a), b);

function base() {
  const b = emptyShipBuild('Ghost');
  b.identity.sizeId = 'med';
  b.abilities.base = { str: 14, dex: 16, con: 14, int: 10, wis: 16, cha: 8 };
  return b;
}

test('the reducer never mutates its input', () => {
  const b = base();
  const next = dispatch(b, { t: 'setName', name: 'Ghost II' });
  expect(b.identity.name).toBe('Ghost');
  expect(next.identity.name).toBe('Ghost II');
  expect(next.equipment).not.toBe(b.equipment);
  expect(next.play.conditions).not.toBe(b.play.conditions);
});

test('setTier clamps to 0..5 and setSize replaces the chassis', () => {
  expect(dispatch(base(), { t: 'setTier', tier: 9 }).identity.tier).toBe(5);
  expect(dispatch(base(), { t: 'setTier', tier: -3 }).identity.tier).toBe(0);
  expect(dispatch(base(), { t: 'setSize', sizeId: 'sm' }).identity.sizeId).toBe('sm');
});

test('changing size or tier shifts current hull/shields by the max delta, clamped', () => {
  let b = dispatch(base(), { t: 'installEquipment', ref: 'directional', kind: 'shield', id: 's1' });
  b.play.hull = computeShip(b, ref).maxHull;
  b.play.shields = computeShip(b, ref).maxShields;
  const before = computeShip(b, ref);
  const after = dispatch(b, { t: 'setTier', tier: 2 });
  const grown = computeShip(after, ref);
  expect(grown.maxHull).toBeGreaterThan(before.maxHull);
  expect(after.play.hull).toBe(grown.maxHull);       // a full ship stays full
  expect(after.play.shields).toBe(grown.maxShields);
  // shrinking clamps rather than going negative
  const shrunk = dispatch(after, { t: 'setSize', sizeId: 'sm' });
  expect(shrunk.play.hull).toBeLessThanOrEqual(computeShip(shrunk, ref).maxHull);
  expect(shrunk.play.hull).toBeGreaterThanOrEqual(0);
});

test('single-slot kinds replace; weapons append with distinct ids and mounts', () => {
  const b = dispatch(base(),
    { t: 'installEquipment', ref: 'deflect', kind: 'armor', id: 'a1' },
    { t: 'installEquipment', ref: 'reinf', kind: 'armor', id: 'a2' },
    { t: 'installEquipment', ref: 'directional', kind: 'shield', id: 's1' },
    { t: 'installEquipment', ref: 'fortress', kind: 'shield', id: 's2' },
    { t: 'installEquipment', ref: 'laser', kind: 'weapon', mount: 'turret', id: 'w1' },
    { t: 'installEquipment', ref: 'laser', kind: 'weapon', id: 'w2' },
  );
  expect(b.equipment.filter((e) => e.kind === 'armor')).toEqual([{ id: 'a2', ref: 'reinf', kind: 'armor' }]);
  expect(b.equipment.filter((e) => e.kind === 'shield')).toEqual([{ id: 's2', ref: 'fortress', kind: 'shield' }]);
  expect(b.equipment.filter((e) => e.kind === 'weapon').map((e) => e.id)).toEqual(['w1', 'w2']);
  expect(b.equipment.find((e) => e.id === 'w1')?.mount).toBe('turret');
});

test('removeEquipment drops the entry by id and forgets its ammo counter', () => {
  let b = dispatch(base(), { t: 'installEquipment', ref: 'laser', kind: 'weapon', id: 'w1' });
  b = { ...b, play: { ...b.play, ammoSpent: { w1: 3 } } };
  const next = dispatch(b, { t: 'removeEquipment', id: 'w1' });
  expect(next.equipment).toEqual([]);
  expect(next.play.ammoSpent).toEqual({});
});

test('setMount retargets a weapon and ignores unknown ids', () => {
  const b = dispatch(base(),
    { t: 'installEquipment', ref: 'laser', kind: 'weapon', id: 'w1' },
    { t: 'setMount', id: 'w1', mount: 'fixed-port' },
    { t: 'setMount', id: 'nope', mount: 'turret' },
  );
  expect(b.equipment[0].mount).toBe('fixed-port');
});

test('installEquipment mints an id when the caller does not supply one', () => {
  const b = dispatch(base(), { t: 'installEquipment', ref: 'laser', kind: 'weapon' });
  expect(b.equipment[0].id).toMatch(/[0-9a-f-]{8,}/);
});

test('toggleModification adds then removes; unknown refs are ignored', () => {
  const on = dispatch(base(), { t: 'toggleModification', ref: 'scrambler' });
  expect(on.modifications).toEqual(['scrambler']);
  expect(dispatch(on, { t: 'toggleModification', ref: 'scrambler' }).modifications).toEqual([]);
  expect(dispatch(base(), { t: 'toggleModification', ref: 'ghost-mod' }).modifications).toEqual([]);
});

test('allocateTierPoint records and removes tier ability increases, capped at 2 per tier', () => {
  let b = dispatch(base(), { t: 'setTier', tier: 2 });
  b = dispatch(b,
    { t: 'allocateTierPoint', tier: 2, ability: 'str', delta: 1 },
    { t: 'allocateTierPoint', tier: 2, ability: 'wis', delta: 1 },
    { t: 'allocateTierPoint', tier: 2, ability: 'dex', delta: 1 },   // budget spent -> ignored
  );
  expect(b.abilities.increases).toEqual([
    { source: 'tier', ref: 't2', ability: 'str', amount: 1 },
    { source: 'tier', ref: 't2', ability: 'wis', amount: 1 },
  ]);
  const back = dispatch(b, { t: 'allocateTierPoint', tier: 2, ability: 'str', delta: -1 });
  expect(back.abilities.increases).toEqual([{ source: 'tier', ref: 't2', ability: 'wis', amount: 1 }]);
});

test('lowering the tier strips increases granted above the new tier', () => {
  let b = dispatch(base(), { t: 'setTier', tier: 3 });
  b = dispatch(b,
    { t: 'allocateTierPoint', tier: 2, ability: 'str', delta: 1 },
    { t: 'allocateTierPoint', tier: 3, ability: 'con', delta: 1 },
  );
  const lowered = dispatch(b, { t: 'setTier', tier: 2 });
  expect(lowered.abilities.increases).toEqual([{ source: 'tier', ref: 't2', ability: 'str', amount: 1 }]);
});

test('toggleHouseRule is additive and reversible', () => {
  const on = dispatch(base(), { t: 'toggleHouseRule', step: 'weapons' });
  expect(on.houseRuled).toEqual(['weapons']);
  expect(dispatch(on, { t: 'toggleHouseRule', step: 'weapons' }).houseRuled).toEqual([]);
});

// --- Carry-forward from Task 14's review: defense.ts's installedOf() trusts an
// equipment entry's `kind` tag and never cross-checks the ref row's actual kind.
// The reducer is the write path that creates entries, so it must derive `kind`
// from the ref row itself -- never from caller input -- or a mistagged entry
// (e.g. kind 'armor' pointing at a shield row) could silently corrupt AC.

test('installEquipment derives kind from the ref row, never from the caller', () => {
  // 'directional' is a shield row; the caller mistags it as armor.
  const b = dispatch(base(), { t: 'installEquipment', ref: 'directional', kind: 'armor', id: 'x1' });
  expect(b.equipment).toEqual([{ id: 'x1', ref: 'directional', kind: 'shield' }]);
  // No armor entry was created, so AC must match the no-armor baseline exactly
  // (proving the shield row's baseAc/dexCap never leaked into the armor slot).
  expect(computeShip(b, ref).armorClass).toBe(computeShip(base(), ref).armorClass);
  expect(computeShip(b, ref).maxShields).toBeGreaterThan(0); // it WAS installed, correctly, as a shield
});

test('installEquipment refuses an unresolvable ref regardless of the claimed kind', () => {
  const b = dispatch(base(), { t: 'installEquipment', ref: 'ghost-ref', kind: 'weapon', id: 'x1' });
  expect(b.equipment).toEqual([]);
});

// --- Review round 1, Important #1: the delta -1 branch of allocateTierPoint
// spliced the increase and broke before any pool bookkeeping, while every
// other max-changing path reconciles play.hull/shields. Allocating then
// de-allocating a CON point left play.hull stuck above the (now lower) max.

test('allocateTierPoint reconciles play.hull on de-allocate, not just allocate', () => {
  const b0 = base();
  b0.abilities.base = { ...b0.abilities.base, con: 13 }; // odd score: +1 crosses a modifier boundary
  let b = dispatch(b0, { t: 'setTier', tier: 2 });
  b.play.hull = computeShip(b, ref).maxHull; // ship starts full
  const originalMax = computeShip(b, ref).maxHull;
  const originalHull = b.play.hull;

  const allocated = dispatch(b, { t: 'allocateTierPoint', tier: 2, ability: 'con', delta: 1 });
  const grownMax = computeShip(allocated, ref).maxHull;
  expect(grownMax).toBeGreaterThan(originalMax);   // sanity: the point actually moved the max
  expect(allocated.play.hull).toBe(grownMax);      // stayed full while growing

  const deallocated = dispatch(allocated, { t: 'allocateTierPoint', tier: 2, ability: 'con', delta: -1 });
  expect(computeShip(deallocated, ref).maxHull).toBe(originalMax);
  expect(deallocated.play.hull).toBe(originalHull);        // back to where it started
  expect(deallocated.play.hull).toBeLessThanOrEqual(computeShip(deallocated, ref).maxHull);
});
