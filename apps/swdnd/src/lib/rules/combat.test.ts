// apps/swdnd/src/lib/rules/combat.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type RefArmor, type RefClass, type RefSpecies, type ReferenceData } from './types';
import { maxHp, armorClass, initiative, speed, hitDice } from './combat';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: [], skillNumber: 2, powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30 };
const beskar: RefArmor = { id: 'beskar', name: 'Beskar weave', baseAc: 14, dexCap: 2, kind: 'medium' };
const shield: RefArmor = { id: 'shield', name: 'Light shield', baseAc: 2, dexCap: null, kind: 'shield' };

function ref(over: Partial<ReferenceData> = {}): ReferenceData {
  return { classes: { consular }, archetypes: {}, species: { human }, armor: { beskar, shield }, weapons: {}, powers: {}, ...over };
}

test('maxHp: first level max die + later levels average, plus con each level', () => {
  const b = emptyBuild('Lyra');
  b.abilities.base.con = 12; // +1
  b.levels = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, classId: 'consular', archetypeId: null, hp: 'avg' as const }));
  // L1 = 6 + 1 = 7 ; L2-5 = (3+1)+1 = 5 each -> 20 ; total 27
  expect(maxHp(b, ref())).toBe(27);
});

test('maxHp honors a rolled level value', () => {
  const b = emptyBuild('x');
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }, // 6
    { n: 2, classId: 'consular', archetypeId: null, hp: 5 },     // 5
  ];
  expect(maxHp(b, ref())).toBe(11);
});

test('armorClass: unarmored, medium with dex cap, plus shield', () => {
  const b = emptyBuild('x');
  b.abilities.base.dex = 14; // +2
  expect(armorClass(b, ref())).toBe(12); // 10 + 2
  b.equipment = [{ ref: 'beskar', qty: 1, equipped: true }];
  expect(armorClass(b, ref())).toBe(16); // 14 + min(2,2)
  b.equipment.push({ ref: 'shield', qty: 1, equipped: true });
  expect(armorClass(b, ref())).toBe(18); // + shield 2
});

test('heavy armor ignores dex; light armor uncapped', () => {
  const b = emptyBuild('x');
  b.abilities.base.dex = 18; // +4
  const heavy: RefArmor = { id: 'h', name: 'Heavy', baseAc: 18, dexCap: 0, kind: 'heavy' };
  const light: RefArmor = { id: 'l', name: 'Light', baseAc: 11, dexCap: null, kind: 'light' };
  b.equipment = [{ ref: 'h', qty: 1, equipped: true }];
  expect(armorClass(b, ref({ armor: { h: heavy, l: light } }))).toBe(18);
  b.equipment = [{ ref: 'l', qty: 1, equipped: true }];
  expect(armorClass(b, ref({ armor: { h: heavy, l: light } }))).toBe(15); // 11 + 4
});

test('initiative, speed, hit dice', () => {
  const b = emptyBuild('x');
  b.abilities.base.dex = 14;
  b.identity.speciesId = 'human';
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: null, hp: 'avg' },
  ];
  expect(initiative(b)).toBe(2);
  expect(speed(b, ref())).toBe(30);
  expect(hitDice(b, ref())).toEqual({ d6: 2 });
});
