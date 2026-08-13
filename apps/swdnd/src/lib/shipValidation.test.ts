// apps/swdnd/src/lib/shipValidation.test.ts
import { expect, test } from 'bun:test';
import { computeShip } from './shipRules';
import { emptyShipBuild, type RefShipArmor, type RefShipModification, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './shipRules/types';
import { SHIP_STEP_ORDER, shipStepStatus } from './shipValidation';

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
const weaponRow = (id: string): RefShipWeapon => ({
  id, name: id, category: 'primary', damageParts: [], rangeNormal: null, rangeLong: null,
  saveAbility: '', reload: null, usesAmmo: false, ammoTypes: [], weaponSize: null,
  attackBonus: 0, price: null, description: '',
});
const modRow = (id: string, system: string): RefShipModification => ({
  id, name: id, system, grade: 0, prerequisite: null, freeSlot: false, freeSuite: false, baseCost: null, description: '',
});

const ref: ShipReferenceData = {
  sizes: { sm: small },
  armor: {
    deflect: armorRow({ id: 'deflect', name: 'Deflection Armor', dexCap: 2, damageReduction: 3 }),
    directional: armorRow({ id: 'directional', name: 'Directional Shield', kind: 'shield', baseAc: 0, capacityCoefficient: 1, regenCoefficient: 1 }),
  },
  equipment: {},
  weapons: { laser: weaponRow('laser'), ion: weaponRow('ion'), pod: weaponRow('pod') },
  modifications: { eng: modRow('eng', 'Engineering'), uni: modRow('uni', 'Universal'), lounge: modRow('lounge', 'Suite') },
};

const status = (b = ship()) => shipStepStatus(b, ref, computeShip(b, ref));

function ship() {
  const b = emptyShipBuild('Ghost');
  b.abilities.base = { str: 14, dex: 14, con: 12, int: 10, wis: 14, cha: 10 };
  return b;
}

test('the step order is the approved six', () => {
  expect(SHIP_STEP_ORDER).toEqual(['size', 'tier', 'hull', 'weapons', 'equipment', 'modifications']);
});

test('an untouched ship reports every step untouched, all applicable', () => {
  const s = status();
  expect(s.size).toEqual({ state: 'untouched', summary: '—', applicable: true });
  expect(s.tier.state).toBe('untouched');
  expect(s.weapons.state).toBe('untouched');
  expect(SHIP_STEP_ORDER.every((k) => s[k].applicable)).toBe(true);
});

test('size and tier report their chosen values', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  b.identity.tier = 3;
  // tiers 1-3 grant 2 points each = 6; fully allocated so tier reads 'done'.
  b.abilities.increases = [
    { source: 'tier', ref: 't1', ability: 'str', amount: 2 },
    { source: 'tier', ref: 't2', ability: 'dex', amount: 2 },
    { source: 'tier', ref: 't3', ability: 'con', amount: 2 },
  ];
  const s = status(b);
  expect(s.size).toMatchObject({ state: 'done', summary: 'Small Starship' });
  expect(s.tier).toMatchObject({ state: 'done', summary: 'tier 3' });
});

test('tier flags unspent ability points', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  b.identity.tier = 2;
  b.abilities.increases = [{ source: 'tier', ref: 't1', ability: 'str', amount: 1 }];
  // tiers 1 and 2 grant 2 points each = 4; only 1 is allocated.
  expect(status(b)).toMatchObject({ tier: { state: 'attention', summary: 'tier 2 · 3 pts left' } });
});

test('hull step summarises the two pools and warns when no shield generator is installed', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  const bare = status(b).hull;
  expect(bare.state).toBe('attention');
  expect(bare.summary).toContain('no shield generator');
  b.equipment = [{ id: 's1', ref: 'directional', kind: 'shield' }];
  const shielded = status(b).hull;
  expect(shielded.state).toBe('done');
  expect(shielded.summary).toMatch(/^hull \d+ · shields \d+$/);
});

test('weapons report hardpoint capacity and go to attention when over budget', () => {
  const b = ship();
  b.identity.sizeId = 'sm';                       // tier 0 -> ceil(1 * 1) = 1 hardpoint
  b.equipment = [{ id: 'w1', ref: 'laser', kind: 'weapon' }];
  expect(status(b).weapons).toMatchObject({ state: 'done', summary: '1/1 hardpoints' });

  b.equipment.push({ id: 'w2', ref: 'ion', kind: 'weapon' });
  expect(status(b).weapons).toMatchObject({ state: 'attention', summary: '2/1 hardpoints' });

  // the ⌂ house-rule unlock silences the over-budget warning
  b.houseRuled = ['weapons'];
  expect(status(b).weapons.state).toBe('done');
});

test('equipment reports the installed armor and shield by name', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  b.equipment = [
    { id: 'a1', ref: 'deflect', kind: 'armor' },
    { id: 's1', ref: 'directional', kind: 'shield' },
  ];
  expect(status(b).equipment).toMatchObject({
    state: 'done', summary: 'Deflection Armor · Directional Shield',
  });
});

test('modifications report slot and suite budgets separately', () => {
  const b = ship();
  b.identity.sizeId = 'sm';
  b.identity.tier = 2;                            // 3 slots, 1 suite
  b.modifications = ['eng', 'uni', 'lounge'];
  expect(status(b).modifications).toMatchObject({ state: 'done', summary: '2/3 slots · suite 1/1' });

  b.modifications = ['eng', 'uni', 'lounge', 'eng'];
  expect(status(b).modifications.state).toBe('done');         // 3 slots used vs 3 is fine…
  b.identity.tier = 0;                                        // …but 1 slot at tier 0 is not
  expect(status(b).modifications.state).toBe('attention');
});
