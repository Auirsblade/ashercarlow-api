// apps/swdnd/src/lib/rules/weaponAttacks.test.ts
import { expect, test } from 'bun:test';
import { emptyBuild, type RefWeapon, type ReferenceData } from './types';
import { computeSheet } from './index';
import { substituteMod, weaponAttacks } from './weaponAttacks';

const w = (over: Partial<RefWeapon> & { id: string }): RefWeapon => ({
  name: over.id, damageParts: [], properties: {}, ability: '', attackBonus: 0,
  price: null, description: '', ...over,
});

const ref = {
  classes: { fighter: { id: 'fighter', name: 'Fighter', hitDie: 10, saves: [], skillChoices: [], skillNumber: 0, powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0, identifier: 'fighter', asiLevels: [], description: '' } },
  archetypes: {}, species: {}, armor: {}, powers: {}, backgrounds: {}, feats: {}, maneuvers: {}, gear: {},
  weapons: {
    vibro: w({ id: 'vibro', name: 'Vibroblade', damageParts: [['1d8 + @mod', 'kinetic']] }),
    dagger: w({ id: 'dagger', name: 'Chained dagger', properties: { fin: true }, damageParts: [['1d4 + @mod', 'kinetic']] }),
    bowcaster: w({ id: 'bowcaster', name: 'Bowcaster', properties: { ran: true }, damageParts: [['1d10 + @mod', 'energy']] }),
    holdout: w({ id: 'holdout', name: 'Holdout', ability: 'cha', attackBonus: 2, damageParts: [['1d4 + @mod', 'energy']] }),
    club: w({ id: 'club', name: 'Club', damageParts: [['1d6 + @mod', 'kinetic']] }),
  },
} as unknown as ReferenceData;

function hero(str: number, dex: number) {
  const b = emptyBuild('Hero');
  b.abilities.base = { str, dex, con: 10, int: 10, wis: 10, cha: 18 };
  b.levels = [{ n: 1, classId: 'fighter', archetypeId: null, hp: 'avg' }];
  b.equipment = [
    { ref: 'vibro', qty: 1, equipped: true },
    { ref: 'dagger', qty: 1, equipped: true },
    { ref: 'bowcaster', qty: 1, equipped: true },
    { ref: 'holdout', qty: 1, equipped: true },
    { ref: 'club', qty: 1, equipped: false },
  ];
  return b;
}

const byId = (list: ReturnType<typeof weaponAttacks>, id: string) => list.find((a) => a.id === id)!;

test('default weapon uses STR; prof + ability mod fold into the attack bonus', () => {
  const b = hero(16, 12);                       // STR +3, DEX +1, prof +2
  const list = weaponAttacks(b, computeSheet(b, ref), ref);
  expect(byId(list, 'vibro')).toMatchObject({
    ability: 'str', attackBonus: 5, damageFormula: '1d8 + 3', damageType: 'kinetic',
  });
});

test('finesse picks the higher of STR and DEX, either direction', () => {
  const dexy = hero(10, 18);                    // STR +0, DEX +4
  expect(byId(weaponAttacks(dexy, computeSheet(dexy, ref), ref), 'dagger'))
    .toMatchObject({ ability: 'dex', attackBonus: 6, damageFormula: '1d4 + 4' });
  const strong = hero(18, 10);                  // STR +4, DEX +0
  expect(byId(weaponAttacks(strong, computeSheet(strong, ref), ref), 'dagger').ability).toBe('str');
});

test('ranged picks DEX even when STR is higher', () => {
  const b = hero(18, 12);                       // STR +4, DEX +1
  expect(byId(weaponAttacks(b, computeSheet(b, ref), ref), 'bowcaster'))
    .toMatchObject({ ability: 'dex', attackBonus: 3, damageFormula: '1d10 + 1', damageType: 'energy' });
});

test('an explicit RefWeapon.ability wins, and RefWeapon.attackBonus folds in', () => {
  const b = hero(16, 12);                       // CHA 18 → +4, prof +2, weapon +2
  expect(byId(weaponAttacks(b, computeSheet(b, ref), ref), 'holdout'))
    .toMatchObject({ ability: 'cha', attackBonus: 8, damageFormula: '1d4 + 4' });
});

test('only equipped weapons are listed', () => {
  const b = hero(16, 12);
  expect(weaponAttacks(b, computeSheet(b, ref), ref).map((a) => a.id))
    .toEqual(['vibro', 'dagger', 'bowcaster', 'holdout']);
});

test('substituteMod drops the term at +0 and flips the sign when negative', () => {
  expect(substituteMod('1d8 + @mod', 3)).toBe('1d8 + 3');
  expect(substituteMod('1d8 + @mod', 0)).toBe('1d8');
  expect(substituteMod('1d8 + @mod', -1)).toBe('1d8 - 1');
  expect(substituteMod('2d6', 4)).toBe('2d6');
});

test('a weapon with no damage parts still yields an attack entry', () => {
  const b = hero(16, 12);
  b.equipment = [{ ref: 'none', qty: 1, equipped: true }];
  const bare = { ...ref, weapons: { ...ref.weapons, none: w({ id: 'none', name: 'Bare fists' }) } } as ReferenceData;
  expect(weaponAttacks(b, computeSheet(b, bare), bare)[0])
    .toMatchObject({ id: 'none', damageFormula: '', damageType: '' });
});
