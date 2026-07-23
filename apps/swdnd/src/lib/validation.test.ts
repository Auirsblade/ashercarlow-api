// apps/swdnd/src/lib/validation.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type DerivedSheet, type ReferenceData, type RefClass, type RefSpecies } from './rules/types';
import { computeSheet } from './rules';
import { stepStatus, STEP_ORDER } from './validation';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
  identifier: 'consular', asiLevels: [4, 8, 12, 16, 19],
};
const sage = {
  id: 'sage', name: 'Sage', classIdentifier: 'consular', description: '',
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30, description: '', abilityIncreases: { fixed: {}, points: 4 } };
const ref = {
  classes: { consular }, species: { human }, archetypes: { sage }, armor: {}, weapons: {},
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

const levelsOf = (classId: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ n: i + 1, classId, archetypeId: null as string | null, hp: 'avg' as const, choices: {} as Record<string, unknown> }));

test('class step: ASI row without an election flags attention', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 4);
  b.levels[2].archetypeId = 'sage';
  const s = stepStatus(b, ref, computeSheet(b, ref));
  expect(s.class.state).toBe('attention');
  expect(s.class.summary).toBe('L4 ASI/feat pending');
});

test('class step: half-spent ASI reports points left; fully spent + archetype is done', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 4);
  b.levels[2].archetypeId = 'sage';
  b.levels[3].choices = { asiOrFeat: 'asi' };
  b.abilities.increases.push({ source: 'asi', ref: 'l4', ability: 'wis', amount: 1 });
  let s = stepStatus(b, ref, computeSheet(b, ref));
  expect(s.class.state).toBe('attention');
  expect(s.class.summary).toBe('L4 ASI · 1 pt left');
  b.abilities.increases.push({ source: 'asi', ref: 'l4', ability: 'wis', amount: 1 });
  s = stepStatus(b, ref, computeSheet(b, ref));
  expect(s.class.state).toBe('done');
  expect(s.class.summary).toBe('Consular 4');
});

test('class step: 3+ levels without an archetype is attention', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 3);
  const s = stepStatus(b, ref, computeSheet(b, ref));
  expect(s.class.state).toBe('attention');
  expect(s.class.summary).toBe('Consular archetype pending');
});

test('class step: feat election satisfies the row (slot emptiness is the feats step)', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 4);
  b.levels[2].archetypeId = 'sage';
  b.levels[3].choices = { asiOrFeat: 'feat' };
  const d = computeSheet(b, ref);
  const s = stepStatus(b, ref, d);
  expect(s.class.state).toBe('done');
  expect(s.feats.state).toBe('attention');
  expect(s.feats.summary).toBe('1 slot empty');
  b.levels[3].choices = { asiOrFeat: 'feat', featId: 'f1' };
  const s2 = stepStatus(b, ref, computeSheet(b, ref));
  expect(s2.feats.state).toBe('done');
  expect(s2.feats.summary).toBe('1 feat');
});

test('feats step unchanged for a pure L1 build', () => {
  const b = emptyBuild('x');
  b.levels = levelsOf('consular', 1);
  expect(stepStatus(b, ref, computeSheet(b, ref)).feats).toMatchObject({ state: 'done', summary: 'optional' });
});
