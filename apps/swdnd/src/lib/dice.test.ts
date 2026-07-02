// apps/swdnd/src/lib/dice.test.ts
import { test, expect } from 'bun:test';
import { rollDie, rollD20, rollDamage, type Rng } from './dice';

// Deterministic RNG that yields the given [0,1) values in order, then repeats the last.
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('rollDie maps [0,1) to 1..sides', () => {
  expect(rollDie(20, seq([0]))).toBe(1);
  expect(rollDie(20, seq([0.999]))).toBe(20);
  expect(rollDie(6, seq([0.5]))).toBe(4);
});

test('rollD20 adds modifier; advantage keeps the higher', () => {
  expect(rollD20(3, {}, seq([0.5]))).toMatchObject({ total: 14, kept: 11, mod: 3 });
  const adv = rollD20(0, { advantage: true }, seq([0.1, 0.95])); // rolls 3, 20 -> keep 20
  expect(adv).toMatchObject({ kept: 20, total: 20, rolls: [3, 20] });
  const dis = rollD20(0, { disadvantage: true }, seq([0.1, 0.95])); // keep 3
  expect(dis.kept).toBe(3);
  // advantage + disadvantage together: advantage wins (keeps the higher)
  const both = rollD20(0, { advantage: true, disadvantage: true }, seq([0.1, 0.95]));
  expect(both.kept).toBe(20);
});

test('rollDamage parses NdM+K', () => {
  const r = rollDamage('2d6+3', seq([0.99, 0.99])); // 6 + 6 + 3
  expect(r.total).toBe(15);
  expect(r.rolls).toEqual([6, 6]);
  expect(rollDamage('1d8', seq([0])).total).toBe(1);
});
