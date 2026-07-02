// apps/swdnd/src/lib/rules/index.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type RefClass, type RefSpecies, type ReferenceData } from './types';
import { computeSheet } from './index';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: [], skillNumber: 2, powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30 };
const ref: ReferenceData = { classes: { consular }, archetypes: {}, species: { human }, armor: {}, weapons: {}, powers: {} };

function lyra() {
  const b = emptyBuild('Lyra Voss');
  b.identity = { name: 'Lyra Voss', speciesId: 'human', backgroundId: '', alignment: 'light' };
  b.abilities.base = { str: 10, dex: 14, con: 12, int: 13, wis: 17, cha: 11 };
  b.levels = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, classId: 'consular', archetypeId: null, hp: 'avg' as const }));
  b.proficiencies.savingThrows = ['wis', 'cha'];
  b.proficiencies.skills = ['ins', 'per'];
  return b;
}

test('computeSheet assembles a full derived sheet (Consular 5)', () => {
  const s = computeSheet(lyra(), ref);
  expect(s.totalLevel).toBe(5);
  expect(s.proficiencyBonus).toBe(3);
  expect(s.abilities.wis).toEqual({ score: 17, mod: 3 });
  expect(s.maxHp).toBe(27);
  expect(s.armorClass).toBe(12);
  expect(s.initiative).toBe(2);
  expect(s.speed).toBe(30);
  expect(s.hitDice).toEqual({ d6: 5 });
  expect(s.savingThrows.wis.bonus).toBe(6);
  expect(s.casting.force.maxPowerLevel).toBe(3);
  expect(s.casting.force.saveDc).toBe(14);
  expect(s.superiority).toBeNull();
});

test('overrides replace a derived scalar and report the flag is irrelevant to value', () => {
  const b = lyra();
  b.overrides = { maxHp: 40, armorClass: 18 };
  const s = computeSheet(b, ref);
  expect(s.maxHp).toBe(40);
  expect(s.armorClass).toBe(18);
  expect(s.initiative).toBe(2); // untouched
});
