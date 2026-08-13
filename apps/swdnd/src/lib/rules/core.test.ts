// apps/swdnd/src/lib/rules/core.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type CharacterBuild } from './types';
import {
  abilityModifier, totalLevel, proficiencyBonus, totalAbilityScores, classesTaken, classLevelOrdinal,
  deploymentsOf, prestigeOf,
} from './core';

test('abilityModifier uses floor((score-10)/2)', () => {
  expect(abilityModifier(10)).toBe(0);
  expect(abilityModifier(17)).toBe(3);
  expect(abilityModifier(8)).toBe(-1);
});

test('proficiencyBonus steps every 4 levels', () => {
  expect(proficiencyBonus(1)).toBe(2);
  expect(proficiencyBonus(4)).toBe(2);
  expect(proficiencyBonus(5)).toBe(3);
  expect(proficiencyBonus(20)).toBe(6);
});

test('totalAbilityScores folds increases onto the base', () => {
  const b = emptyBuild('x');
  b.abilities.base.wis = 15;
  b.abilities.increases = [
    { source: 'species', ref: 'human', ability: 'wis', amount: 1 },
    { source: 'asi', ref: 'l4', ability: 'wis', amount: 1 },
    { source: 'asi', ref: 'l4', ability: 'cha', amount: 1 },
  ];
  const s = totalAbilityScores(b);
  expect(s.wis).toBe(17);
  expect(s.cha).toBe(11);
  expect(s.str).toBe(10);
});

test('classesTaken groups level entries by class with first archetype', () => {
  const b = emptyBuild('x');
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: 'niman', hp: 'avg' },
    { n: 3, classId: 'guardian', archetypeId: null, hp: 'avg' },
  ];
  expect(totalLevel(b)).toBe(3);
  expect(classesTaken(b)).toEqual([
    { classId: 'consular', archetypeId: 'niman', levels: 2 },
    { classId: 'guardian', archetypeId: null, levels: 1 },
  ]);
});

test('classLevelOrdinal counts within the entry class across interleaving', () => {
  const b = emptyBuild('x');
  b.levels = [
    { n: 1, classId: 'fighter', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 3, classId: 'fighter', archetypeId: null, hp: 'avg' },
    { n: 4, classId: 'fighter', archetypeId: null, hp: 'avg' },
  ];
  expect(classLevelOrdinal(b, 1)).toBe(1);
  expect(classLevelOrdinal(b, 2)).toBe(1);
  expect(classLevelOrdinal(b, 4)).toBe(3);
  expect(classLevelOrdinal(b, 9)).toBe(0);
});

test('deploymentsOf / prestigeOf tolerate pre-v2 documents', () => {
  const legacy = { ...emptyBuild('Old'), schemaVersion: 1 } as CharacterBuild;
  delete (legacy as { deployments?: unknown }).deployments;
  delete (legacy as { prestige?: unknown }).prestige;
  expect(deploymentsOf(legacy)).toEqual([]);
  expect(prestigeOf(legacy)).toBe(0);

  const ranked: CharacterBuild = {
    ...emptyBuild('New'),
    deployments: [{ deploymentId: 'gunner-row', rank: 3 }],
    prestige: 7,
  };
  expect(deploymentsOf(ranked)).toEqual([{ deploymentId: 'gunner-row', rank: 3 }]);
  expect(prestigeOf(ranked)).toBe(7);
});
