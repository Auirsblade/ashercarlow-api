// apps/swdnd/src/lib/rules/skills.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild } from './types';
import { savingThrows, skillBonuses } from './skills';

test('saving throws add proficiency where the build is proficient', () => {
  const b = emptyBuild('x');
  b.abilities.base.wis = 17; // +3
  b.abilities.base.con = 12; // +1
  b.levels = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, classId: 'consular', archetypeId: null, hp: 'avg' as const }));
  b.proficiencies.savingThrows = ['wis', 'cha'];
  const saves = savingThrows(b);
  expect(saves.wis).toEqual({ bonus: 6, proficient: true }); // +3 + prof 3
  expect(saves.con).toEqual({ bonus: 1, proficient: false });
});

test('skill bonuses apply proficiency and expertise', () => {
  const b = emptyBuild('x');
  b.abilities.base.int = 16; // +3
  b.abilities.base.dex = 14; // +2
  b.levels = [{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }]; // prof 2
  b.proficiencies.skills = ['lor', 'ste'];
  b.proficiencies.expertise = ['lor'];
  const skills = skillBonuses(b);
  const lore = skills.find((s) => s.key === 'lor')!;
  const stealth = skills.find((s) => s.key === 'ste')!;
  const acr = skills.find((s) => s.key === 'acr')!;
  expect(lore).toMatchObject({ bonus: 3 + 2 + 2, proficient: true, expertise: true }); // int + prof + prof
  expect(stealth).toMatchObject({ bonus: 2 + 2, proficient: true, expertise: false });
  expect(acr).toMatchObject({ bonus: 2, proficient: false });
  expect(skills).toHaveLength(18);
});
