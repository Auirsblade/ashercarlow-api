// apps/swdnd/src/lib/rules/casting.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type RefClass, type ReferenceData } from './types';
import { computeCasting } from './casting';

function ref(classes: Record<string, RefClass>): ReferenceData {
  return { classes, archetypes: {}, species: {}, armor: {}, weapons: {}, powers: {} };
}
const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: [], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
};
const guardian: RefClass = {
  id: 'guardian', name: 'Guardian', hitDie: 10, saves: ['con', 'cha'],
  skillChoices: [], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0,
};

test('single full forcecaster L5 (light, wis 17)', () => {
  const b = emptyBuild('Lyra');
  b.identity.alignment = 'light';
  b.abilities.base.wis = 17;
  b.levels = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, classId: 'consular', archetypeId: null, hp: 'avg' as const }));
  const r = computeCasting(b, ref({ consular }));
  expect(r.force.casterLevel).toBe(5);
  expect(r.force.maxPowerLevel).toBe(3);
  expect(r.force.knownMax).toBe(17);
  expect(r.force.ability).toBe('wis');
  expect(r.force.pointsMax).toBe(20 + 3); // 5*4 base + wis mod 3
  expect(r.force.saveDc).toBe(8 + 3 + 3); // 8 + prof(3) + wis(3)
  expect(r.force.attackBonus).toBe(3 + 3);
  expect(r.tech.classes).toBe(0);
  expect(r.tech.saveDc).toBeNull();
});

test('dark forcecaster uses charisma', () => {
  const b = emptyBuild('Sith');
  b.identity.alignment = 'dark';
  b.abilities.base.cha = 16;
  b.levels = [{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg' }];
  const r = computeCasting(b, ref({ consular }));
  expect(r.force.ability).toBe('cha');
  expect(r.force.saveDc).toBe(8 + 2 + 3); // prof 2 + cha mod 3
});

test('two forcecasting classes use combined caster level for max power level', () => {
  const trickster: RefClass = { ...consular, id: 'trickster', name: 'Trickster', powercasting: { force: '3/4', tech: 'none' } };
  const b = emptyBuild('Multi');
  b.identity.alignment = 'light';
  b.abilities.base.wis = 14;
  b.levels = [
    { n: 1, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 2, classId: 'consular', archetypeId: null, hp: 'avg' },
    { n: 3, classId: 'trickster', archetypeId: null, hp: 'avg' },
    { n: 4, classId: 'trickster', archetypeId: null, hp: 'avg' },
    { n: 5, classId: 'trickster', archetypeId: null, hp: 'avg' },
  ];
  const r = computeCasting(b, ref({ consular, trickster }));
  // casterLevel = 2*1 + 3*(7/9) = 4.333 -> round 4 ; classes 2 -> full[4] = 2
  expect(r.force.casterLevel).toBe(4);
  expect(r.force.maxPowerLevel).toBe(2);
  expect(r.force.pointsMax).toBe(2 * 4 + 3 * 3 + 2); // 8 + 9 + wis mod 2 = 19
});

test('non-casting class contributes nothing', () => {
  const b = emptyBuild('Tank');
  b.levels = [{ n: 1, classId: 'guardian', archetypeId: null, hp: 'avg' }];
  const r = computeCasting(b, ref({ guardian }));
  expect(r.force.classes).toBe(0);
  expect(r.force.maxPowerLevel).toBe(0);
});

test('tech half-caster grants nothing before class level 2', () => {
  const scholar1: RefClass = { ...consular, id: 'scholar', name: 'Scholar', powercasting: { force: 'none', tech: 'half' } };
  const b = emptyBuild('Scholar');
  b.abilities.base.int = 16;
  b.levels = [{ n: 1, classId: 'scholar', archetypeId: null, hp: 'avg' }];
  expect(computeCasting(b, ref({ scholar: scholar1 })).tech.classes).toBe(0);
  b.levels.push({ n: 2, classId: 'scholar', archetypeId: null, hp: 'avg' });
  const r2 = computeCasting(b, ref({ scholar: scholar1 }));
  expect(r2.tech.classes).toBe(1);
  expect(r2.tech.ability).toBe('int');
  expect(r2.tech.pointsMax).toBe(Math.round((2 * 2) / 2) + 3); // base 4 halved = 2, + int mod 3
});
