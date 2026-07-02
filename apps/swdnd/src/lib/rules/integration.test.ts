// apps/swdnd/src/lib/rules/integration.test.ts
import { test, expect } from 'bun:test';
import { computeSheet } from './index';
import { emptyBuild, type RefArchetype, type RefArmor, type RefClass, type RefSpecies, type ReferenceData } from './types';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
};
const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: ['ath', 'prc'], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0.5,
};
const ref: ReferenceData = {
  classes: { consular, fighter },
  archetypes: {} as Record<string, RefArchetype>,
  species: { human: { id: 'human', name: 'Human', walkSpeed: 30 } as RefSpecies },
  armor: { combatsuit: { id: 'combatsuit', name: 'Combat suit', baseAc: 11, dexCap: null, kind: 'light' } as RefArmor },
  weapons: {}, powers: {},
};

test('Consular 4 / Fighter 1 multiclass sheet', () => {
  const b = emptyBuild('Mixed');
  b.identity = { name: 'Mixed', speciesId: 'human', backgroundId: '', alignment: 'light' };
  b.abilities.base = { str: 12, dex: 14, con: 14, int: 10, wis: 16, cha: 12 };
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 3, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 4, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 5, classId: 'fighter', archetypeId: null, hp: 'avg' },
  ];
  b.proficiencies.savingThrows = ['wis', 'cha'];
  b.proficiencies.skills = ['lor', 'ins'];
  b.equipment = [{ ref: 'combatsuit', qty: 1, equipped: true }];

  const s = computeSheet(b, ref);
  expect(s.totalLevel).toBe(5);
  expect(s.proficiencyBonus).toBe(3);
  // HP: consular L1 6+2 ; L2-4 (4+2)x3=18 ; fighter L5 (6+2)=8  -> 8+18+8 = 34
  expect(s.maxHp).toBe(34);
  // AC: light 11 + dex 2 = 13
  expect(s.armorClass).toBe(13);
  expect(s.hitDice).toEqual({ d6: 4, d10: 1 });
  // Force: only consular casts -> classes 1 ; casterLevel 4 ; maxPowerLevel full[4]=2
  expect(s.casting.force.classes).toBe(1);
  expect(s.casting.force.maxPowerLevel).toBe(2);
  expect(s.casting.force.ability).toBe('wis');
  expect(s.casting.force.pointsMax).toBe(4 * 4 + 3); // 16 + wis mod 3
  // Superiority: fighter 0.5 @ 1 level -> dice round(quant[1]*0.5)=round(1.5)=2 ; die size[1]=d4 ; level round(0.5)=1
  expect(s.superiority).toEqual({ level: 1, diceMax: 2, die: 'd4', knownMax: 1 });
});
