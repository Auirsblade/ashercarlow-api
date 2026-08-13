// apps/swdnd/src/lib/shipRules/weapons.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type RefShipSize, type RefShipWeapon, type ShipReferenceData } from './types';
import { rateOfFireCap, shipSaveDc, shipWeaponProfiles } from './weapons';

const size = (key: RefShipSize['key']): RefShipSize => ({
  id: key, name: key, key, hullDie: 8, hullDiceStart: 5, shieldDie: 8, shieldDiceStart: 5,
  spaceSpeed: 300, turnSpeed: 200, hardpointMult: 1.5, modBaseCap: 30,
  modMaxSuitesBase: 3, modMaxSuitesMult: 1, description: '',
});
const weapon = (over: Partial<RefShipWeapon> & { id: string }): RefShipWeapon => ({
  name: over.id, category: 'primary', damageParts: [], rangeNormal: null, rangeLong: null,
  saveAbility: '', reload: null, usesAmmo: false, ammoTypes: [], weaponSize: null,
  attackBonus: 0, price: null, description: '', ...over,
});

const ref: ShipReferenceData = {
  sizes: { medium: size('medium'), small: size('small'), gargantuan: size('gargantuan'), large: size('large'), huge: size('huge'), tiny: size('tiny') },
  armor: {}, equipment: {}, modifications: {},
  weapons: {
    laser: weapon({ id: 'laser', name: 'Twin laser cannon', category: 'primary',
      damageParts: [['1d8 + @mod', 'energy']], rangeNormal: 600, rangeLong: 2400 }),
    ion: weapon({ id: 'ion', name: 'Ion battery', category: 'secondary', saveAbility: 'con',
      damageParts: [['4d6', 'ion']], attackBonus: 1 }),
    bomb: weapon({ id: 'bomb', name: 'Bomb deployer', category: 'quaternary',
      usesAmmo: true, reload: 4, ammoTypes: ['ssbomb'], damageParts: [['0d0 + @mod', '-']] }),
  },
};

function ship(opts: { size?: string; str?: number; wis?: number } = {}) {
  const b = emptyShipBuild('Ghost');
  b.identity.sizeId = opts.size ?? 'medium';
  b.abilities.base = { str: opts.str ?? 10, dex: 10, con: 10, int: 10, wis: opts.wis ?? 10, cha: 10 };
  return b;
}

test('a weapon profile carries the WIS attack part, the literal proficiency suffix and STR damage', () => {
  const b = ship({ wis: 16, str: 14 });                       // WIS +3, STR +2
  b.equipment = [{ id: 'w1', ref: 'laser', kind: 'weapon', mount: 'turret' }];
  const [p] = shipWeaponProfiles(b, ref);
  expect(p).toMatchObject({
    entryId: 'w1', refId: 'laser', name: 'Twin laser cannon', category: 'primary', mount: 'turret',
    attackShipMod: 3, attackText: '+3 + your proficiency',
    damageFormula: '1d8 + 2', damageType: 'energy',
    rangeNormal: 600, rangeLong: 2400, saveDc: null, usesAmmo: false, reload: null,
  });
});

test('the weapon reference attackBonus folds into the ship part', () => {
  const b = ship({ wis: 16 });
  b.equipment = [{ id: 'w1', ref: 'ion', kind: 'weapon' }];
  const [p] = shipWeaponProfiles(b, ref);
  expect(p.attackShipMod).toBe(4);                            // WIS +3 + weapon +1
  expect(p.attackText).toBe('+4 + your proficiency');
});

test('save-based weapons get 8 + WIS mod; attack-based weapons get null', () => {
  const b = ship({ wis: 18 });                                // +4 -> DC 12
  b.equipment = [
    { id: 'w1', ref: 'ion', kind: 'weapon' },
    { id: 'w2', ref: 'laser', kind: 'weapon' },
  ];
  const [ion, laser] = shipWeaponProfiles(b, ref);
  expect(ion).toMatchObject({ saveAbility: 'con', saveDc: 12 });
  expect(laser.saveDc).toBeNull();
  expect(shipSaveDc(b)).toBe(12);
});

test('a negative attack part still renders a signed suffix', () => {
  const b = ship({ wis: 6 });                                 // -2
  b.equipment = [{ id: 'w1', ref: 'laser', kind: 'weapon' }];
  expect(shipWeaponProfiles(b, ref)[0].attackText).toBe('-2 + your proficiency');
});

test('ammo and reload flow through; the default mount is fixed-forward', () => {
  const b = ship();
  b.equipment = [{ id: 'w1', ref: 'bomb', kind: 'weapon' }];
  expect(shipWeaponProfiles(b, ref)[0]).toMatchObject({ mount: 'fixed-forward', usesAmmo: true, reload: 4 });
});

test('non-weapon entries and unknown refs are skipped', () => {
  const b = ship();
  b.equipment = [
    { id: 'a1', ref: 'deflect', kind: 'armor' },
    { id: 'w9', ref: 'ghost-gun', kind: 'weapon' },
    { id: 'w1', ref: 'laser', kind: 'weapon' },
  ];
  expect(shipWeaponProfiles(b, ref).map((p) => p.entryId)).toEqual(['w1']);
});

test('non-installable category "other" rows (ammo/simpleVW) are skipped even if referenced as equipment', () => {
  const otherRef: ShipReferenceData = {
    ...ref,
    weapons: { ...ref.weapons, ssbomb: weapon({ id: 'ssbomb', category: 'other' }) },
  };
  const b = ship();
  b.equipment = [
    { id: 'w1', ref: 'ssbomb', kind: 'weapon' },
    { id: 'w2', ref: 'laser', kind: 'weapon' },
  ];
  expect(shipWeaponProfiles(b, otherRef).map((p) => p.entryId)).toEqual(['w2']);
});

test('rate-of-fire cap is max(Str mod, 1) x the size multiplier, rounded up', () => {
  expect(rateOfFireCap(ship({ str: 10, size: 'medium' }), ref)).toBe(2);   // max(0,1)=1 * 1.5 -> 2
  expect(rateOfFireCap(ship({ str: 18, size: 'medium' }), ref)).toBe(6);   // 4 * 1.5
  expect(rateOfFireCap(ship({ str: 18, size: 'small' }), ref)).toBe(4);    // 4 * 1
  expect(rateOfFireCap(ship({ str: 18, size: 'large' }), ref)).toBe(10);   // 4 * 2.5
  expect(rateOfFireCap(ship({ str: 18, size: 'huge' }), ref)).toBe(8);     // 4 * 2
  expect(rateOfFireCap(ship({ str: 15, size: 'gargantuan' }), ref)).toBe(6); // 2 * 3
  expect(rateOfFireCap(ship({ str: 4, size: 'tiny' }), ref)).toBe(1);      // floor at 1
});
