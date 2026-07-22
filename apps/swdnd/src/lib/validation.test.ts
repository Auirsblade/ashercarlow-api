// apps/swdnd/src/lib/validation.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type DerivedSheet, type ReferenceData, type RefClass, type RefSpecies } from './rules/types';
import { stepStatus, STEP_ORDER } from './validation';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30, description: '', abilityIncreases: { fixed: {}, points: 4 } };
const ref = {
  classes: { consular }, species: { human }, archetypes: {}, armor: {}, weapons: {},
  powers: {
    a: { id: 'a', name: 'A', level: 1, castType: 'force', description: '' },
    b: { id: 'b', name: 'B', level: 1, castType: 'force', description: '' },
    c: { id: 'c', name: 'C', level: 1, castType: 'force', description: '' },
  },
  backgrounds: { jedi: { id: 'jedi', name: 'Jedi', description: '', featureName: null, skillProse: null, toolProse: null, equipmentProse: null } },
  feats: {}, maneuvers: {}, gear: {},
} as unknown as ReferenceData;
const derived = (forceKnownMax = 9, superiority: DerivedSheet['superiority'] = null) => ({
  casting: {
    force: { classes: forceKnownMax > 0 ? 1 : 0, knownMax: forceKnownMax, maxPowerLevel: 1 },
    tech: { classes: 0, knownMax: 0, maxPowerLevel: 0 },
  },
  superiority,
} as unknown as DerivedSheet);

test('empty build: identity steps untouched, feats optional-done', () => {
  const s = stepStatus(emptyBuild('x'), ref, derived(0));
  expect(STEP_ORDER).toEqual(['species', 'background', 'class', 'abilities', 'skills', 'feats', 'equipment', 'powers']);
  expect(s.species.state).toBe('untouched');
  expect(s.background.state).toBe('untouched');
  expect(s.class.state).toBe('untouched');
  expect(s.abilities.state).toBe('untouched');
  expect(s.feats.state).toBe('done'); // optional
  expect(s.equipment.state).toBe('untouched');
  expect(s.powers.applicable).toBe(false); // no casting, no superiority
});

test('species with unallocated free points needs attention', () => {
  const b = emptyBuild('x');
  b.identity.speciesId = 'human'; // 4 free points, none allocated
  const s = stepStatus(b, ref, derived(0));
  expect(s.species.state).toBe('attention');
  b.abilities.increases = Array.from({ length: 4 }, (_, i) => ({
    source: 'species' as const, ref: 'human#choice', ability: 'wis' as const, amount: 1,
  }));
  expect(stepStatus(b, ref, derived(0)).species.state).toBe('done');
});

test('skills: partial is attention, at class count is done', () => {
  const b = emptyBuild('x');
  b.levels = [{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }];
  b.proficiencies.skills = ['ins'];
  expect(stepStatus(b, ref, derived(9)).skills.state).toBe('attention'); // 1 of 2
  b.proficiencies.skills = ['ins', 'lor'];
  expect(stepStatus(b, ref, derived(9)).skills.state).toBe('done');
  expect(stepStatus(b, ref, derived(9)).skills.summary).toContain('2/2');
});

test('abilities done when any base differs from 10', () => {
  const b = emptyBuild('x');
  expect(stepStatus(b, ref, derived(0)).abilities.state).toBe('untouched');
  b.abilities.base.wis = 15;
  expect(stepStatus(b, ref, derived(0)).abilities.state).toBe('done');
});

test('powers: untouched at 0, attention when partial/over, done at knownMax; house-rule = presence only', () => {
  const b = emptyBuild('x');
  b.levels = [{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }];
  const d = derived(2);
  expect(stepStatus(b, ref, d).powers.state).toBe('untouched');
  b.knownPowers = ['a'];
  expect(stepStatus(b, ref, d).powers.state).toBe('attention'); // 1 of 2
  b.knownPowers = ['a', 'b'];
  expect(stepStatus(b, ref, d).powers.state).toBe('done');
  b.knownPowers = ['a', 'b', 'c'];
  expect(stepStatus(b, ref, d).powers.state).toBe('attention'); // over
  b.houseRuled = ['powers'];
  expect(stepStatus(b, ref, d).powers.state).toBe('done'); // presence-only when unlocked
});

test('powers applicable for superiority-only user (Fighter L1)', () => {
  const b = emptyBuild('x');
  const d = derived(0, { level: 1, diceMax: 2, die: 'd4', knownMax: 1 });
  const s = stepStatus(b, ref, d);
  expect(s.powers.applicable).toBe(true);
  b.knownManeuvers = ['m1'];
  expect(stepStatus(b, ref, d).powers.state).toBe('done');
});
