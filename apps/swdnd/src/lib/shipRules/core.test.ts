// apps/swdnd/src/lib/shipRules/core.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild } from './types';
import { shipAbilityModifier, shipTier, totalShipAbilityScores } from './core';

test('shipAbilityModifier follows the standard d20 curve', () => {
  expect(shipAbilityModifier(10)).toBe(0);
  expect(shipAbilityModifier(11)).toBe(0);
  expect(shipAbilityModifier(18)).toBe(4);
  expect(shipAbilityModifier(8)).toBe(-1);
  expect(shipAbilityModifier(1)).toBe(-5);
});

test('totalShipAbilityScores folds tier increases onto the base scores', () => {
  const b = emptyShipBuild('Ghost');
  b.abilities.base = { str: 14, dex: 12, con: 16, int: 10, wis: 13, cha: 8 };
  b.abilities.increases = [
    { source: 'tier', ref: 't2', ability: 'str', amount: 1 },
    { source: 'tier', ref: 't2', ability: 'str', amount: 1 },
    { source: 'tier', ref: 't3', ability: 'wis', amount: 2 },
  ];
  expect(totalShipAbilityScores(b)).toEqual({ str: 16, dex: 12, con: 16, int: 10, wis: 15, cha: 8 });
});

test('a missing base ability falls back to 10', () => {
  const b = emptyShipBuild('Bare');
  delete (b.abilities.base as Record<string, number>).cha;
  expect(totalShipAbilityScores(b).cha).toBe(10);
});

test('shipTier clamps to 0..5', () => {
  const b = emptyShipBuild('Ghost');
  expect(shipTier(b)).toBe(0);
  b.identity.tier = 3;
  expect(shipTier(b)).toBe(3);
  b.identity.tier = 9;
  expect(shipTier(b)).toBe(5);
  b.identity.tier = -2;
  expect(shipTier(b)).toBe(0);
});
