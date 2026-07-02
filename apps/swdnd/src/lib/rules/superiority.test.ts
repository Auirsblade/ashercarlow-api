// apps/swdnd/src/lib/rules/superiority.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type RefClass, type ReferenceData } from './types';
import { computeSuperiority } from './superiority';

function ref(classes: Record<string, RefClass>): ReferenceData {
  return { classes, archetypes: {}, species: {}, armor: {}, weapons: {}, powers: {} };
}
const base: RefClass = {
  id: 'x', name: 'X', hitDie: 10, saves: [], skillChoices: [], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0,
};

test('no superiority classes -> null', () => {
  const b = emptyBuild('x');
  b.levels = [{ n: 1, classId: 'x', archetypeId: null, hp: 'avg' }];
  expect(computeSuperiority(b, ref({ x: base }))).toBeNull();
});

test('full superiority progression at 3 levels', () => {
  const sup: RefClass = { ...base, id: 'bm', superiorityProgression: 1 };
  const b = emptyBuild('x');
  b.levels = Array.from({ length: 3 }, (_, i) => ({ n: i + 1, classId: 'bm', archetypeId: null, hp: 'avg' as const }));
  // dice = round(quant[3]*1)=4 ; die = size[3]='d4' ; known = maneuvers[round(3*1)=3]=4
  expect(computeSuperiority(b, ref({ bm: sup }))).toEqual({ level: 3, diceMax: 4, die: 'd4', knownMax: 4 });
});

test('half progression rounds and uses raw class levels for die size', () => {
  const sup: RefClass = { ...base, id: 'sc', superiorityProgression: 0.5 };
  const b = emptyBuild('x');
  b.levels = Array.from({ length: 4 }, (_, i) => ({ n: i + 1, classId: 'sc', archetypeId: null, hp: 'avg' as const }));
  // dice = round(quant[4]*0.5)=round(2)=2 ; die = size[4]='d4' ; level = round(4*0.5)=2 ; known = maneuvers[2]=2
  expect(computeSuperiority(b, ref({ sc: sup }))).toEqual({ level: 2, diceMax: 2, die: 'd4', knownMax: 2 });
});
