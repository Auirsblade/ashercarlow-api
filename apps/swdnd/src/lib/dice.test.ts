// apps/swdnd/src/lib/dice.test.ts
import { test, expect, describe } from 'bun:test';
import { rollDie, rollD20, rollDamage, type Rng } from './dice';
import { formatFormula, parseFormula, rollFormula } from './dice';

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

describe('parseFormula', () => {
  test('accepts multi-term sums with modifiers', () => {
    expect(parseFormula('2d6+1d8+3')).toEqual({ dice: [{ count: 2, sides: 6 }, { count: 1, sides: 8 }], modifier: 3 });
    expect(parseFormula('1d20-1')).toEqual({ dice: [{ count: 1, sides: 20 }], modifier: -1 });
    expect(parseFormula(' 2D6 + 3 ')).toEqual({ dice: [{ count: 2, sides: 6 }], modifier: 3 });
    expect(parseFormula('1d8+2-1')).toEqual({ dice: [{ count: 1, sides: 8 }], modifier: 1 });
  });
  test('bare dNN means one die', () => {
    expect(parseFormula('d20')).toEqual({ dice: [{ count: 1, sides: 20 }], modifier: 0 });
  });
  test('rejects junk, dice-less, negative-dice, and out-of-range formulas', () => {
    for (const bad of ['', 'abc', '3', '+5', '2d6potato', '2d6 1d8', '-1d6', '0d6', '2d1', '101d6', '2d2000']) {
      expect(parseFormula(bad)).toBeNull();
    }
  });
});

describe('formatFormula', () => {
  test('round-trips and normalizes', () => {
    expect(formatFormula(parseFormula('2d6+1d8+3')!)).toBe('2d6+1d8+3');
    expect(formatFormula(parseFormula('1d20-1')!)).toBe('1d20-1');
    expect(formatFormula(parseFormula('d20')!)).toBe('1d20');
    expect(formatFormula(parseFormula('2d6+0')!)).toBe('2d6');
  });
});

describe('rollFormula', () => {
  test('rolls every die and adds the modifier (seeded rng)', () => {
    const seq = [0.99, 0.0, 0.5]; let i = 0;
    const rng = () => seq[i++ % seq.length];
    const r = rollFormula(parseFormula('2d6+1d8+3')!, rng);
    expect(r.rolls).toEqual([{ sides: 6, value: 6 }, { sides: 6, value: 1 }, { sides: 8, value: 5 }]);
    expect(r.total).toBe(6 + 1 + 5 + 3);
    expect(r.formula).toBe('2d6+1d8+3');
  });
});
