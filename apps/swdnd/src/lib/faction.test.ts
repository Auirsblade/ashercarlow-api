// apps/swdnd/src/lib/faction.test.ts
import { test, expect } from 'bun:test';
import { factionAccent, factionStyle } from './faction';

test('faction accent maps alignment to a color', () => {
  expect(factionAccent('light')).toBe('#7aa2ff');
  expect(factionAccent('dark')).toBe('#ff5470');
  expect(factionAccent('universal')).toBe('#4dd0e1');
  expect(factionAccent('none')).toBe('#4dd0e1');
});

test('factionStyle sets the --faction CSS variable', () => {
  expect(factionStyle('dark')).toEqual({ '--faction': '#ff5470' });
});
