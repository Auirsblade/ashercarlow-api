// apps/swdnd/src/lib/multiclass.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type ReferenceData, type RefClass } from './rules/types';
import { multiclassBlockers } from './multiclass';

const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', identifier: 'fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: [], skillNumber: 2, asiLevels: [4, 6, 8, 12, 14, 16, 19],
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 1, description: '',
};
const consular: RefClass = {
  id: 'consular', name: 'Consular', identifier: 'consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: [], skillNumber: 2, asiLevels: [4, 8, 12, 16, 19],
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const mystery: RefClass = { ...fighter, id: 'mystery', name: 'Mystery', identifier: 'not-in-table' };
const ref = {
  classes: { fighter, consular, mystery },
  archetypes: {}, species: {}, armor: {}, weapons: {}, powers: {}, backgrounds: {}, feats: {}, maneuvers: {}, gear: {},
} as unknown as ReferenceData;

const withLevels = (classIds: string[], base: Partial<Record<'str' | 'wis', number>>) => {
  const b = emptyBuild('x');
  Object.assign(b.abilities.base, base);
  b.levels = classIds.map((classId, i) => ({ n: i + 1, classId, archetypeId: null, hp: 'avg' as const, choices: {} }));
  return b;
};

test('first class and same-class levels are always allowed', () => {
  expect(multiclassBlockers(emptyBuild('x'), ref, 'fighter')).toEqual([]);
  expect(multiclassBlockers(withLevels(['fighter'], { str: 8 }), ref, 'fighter')).toEqual([]);
});

test('new class blocked when ITS primary is under 13', () => {
  const b = withLevels(['fighter'], { str: 13, wis: 12 });
  const blockers = multiclassBlockers(b, ref, 'consular');
  expect(blockers).toHaveLength(1);
  expect(blockers[0]).toBe('Consular needs WIS 13 — you have 12');
});

test('new class blocked when an EXISTING class primary is under 13', () => {
  const b = withLevels(['fighter'], { str: 12, wis: 18 });
  expect(multiclassBlockers(b, ref, 'consular')).toEqual(['Fighter needs STR 13 — you have 12']);
});

test('both sides at 13+ pass; increases count toward the score', () => {
  const b = withLevels(['fighter'], { str: 12, wis: 13 });
  b.abilities.increases.push({ source: 'species', ref: 'sp', ability: 'str', amount: 1 });
  expect(multiclassBlockers(b, ref, 'consular')).toEqual([]);
});

test('unknown identifier fails open (no blocker)', () => {
  const b = withLevels(['fighter'], { str: 13 });
  expect(multiclassBlockers(b, ref, 'mystery')).toEqual([]);
});
