import { test, expect } from 'bun:test';
import { segmentDiceText, hasDice, type RollSeg } from './diceText';

const rolls = (text: string): RollSeg[] =>
  segmentDiceText(text).filter((s): s is RollSeg => s.kind === 'roll');

test('table headers roll the die with the label', () => {
  const [r] = rolls('Roll d8 — Feat');
  expect(r).toMatchObject({ text: 'Roll d8 — Feat', formula: 'd8', label: 'Feat' });
});

test('inline roll codes carry their parenthesised label', () => {
  expect(rolls('Use roll d20 (Wild) when surging.')[0]).toMatchObject({
    text: 'roll d20 (Wild)', formula: 'd20', label: 'Wild',
  });
  expect(rolls('Try roll d4 first.')[0]).toMatchObject({ text: 'roll d4', formula: 'd4' });
});

test('plain expressions match, including spaced modifiers', () => {
  expect(rolls('takes 2d6 fire damage')[0]).toMatchObject({ text: '2d6', formula: '2d6' });
  expect(rolls('slam: 2d8 + 4 kinetic')[0]).toMatchObject({ text: '2d8 + 4', formula: '2d8+4' });
  expect(rolls('hits for 1d20+5.')[0]).toMatchObject({ text: '1d20+5', formula: '1d20+5' });
});

test('segments reproduce the input and non-dice text has none', () => {
  const text = 'Roll d6 — Bond\n1. I will never rest.';
  expect(segmentDiceText(text).map((s) => s.text).join('')).toBe(text);
  expect(hasDice('a d10 hit die and nothing rollable')).toBe(false);
  expect(hasDice('deals 3d6+2')).toBe(true);
});
