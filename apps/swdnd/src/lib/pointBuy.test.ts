// apps/swdnd/src/lib/pointBuy.test.ts
import { test, expect } from 'bun:test';
import { POINT_BUY_BUDGET, scoreCost, pointsSpent, budgetRemaining, isLegalPointBuy } from './pointBuy';
import type { AbilityKey } from './rules/types';

const base = (over: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> => ({
  str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, ...over,
});

test('sw5e cost table (pinned from sw5e.com PHB ch.1)', () => {
  expect(POINT_BUY_BUDGET).toBe(27);
  expect(scoreCost(8)).toBe(0);
  expect(scoreCost(11)).toBe(3);
  expect(scoreCost(14)).toBe(7);
  expect(scoreCost(15)).toBe(9);
  expect(scoreCost(7)).toBeNull();
  expect(scoreCost(16)).toBeNull();
});

test('pointsSpent sums costs; null when any score is out of range', () => {
  expect(pointsSpent(base())).toBe(0);
  expect(pointsSpent(base({ str: 15, dex: 15, con: 15 }))).toBe(27); // 15,15,15,8,8,8
  expect(pointsSpent(base({ str: 16 }))).toBeNull();
});

test('budgetRemaining and legality', () => {
  expect(budgetRemaining(base({ str: 15, dex: 14 }))).toBe(27 - 9 - 7);
  expect(isLegalPointBuy(base({ str: 15, dex: 15, con: 15 }))).toBe(true);
  expect(isLegalPointBuy(base({ str: 15, dex: 15, con: 15, int: 9 }))).toBe(false); // 28 pts
  expect(isLegalPointBuy(base({ str: 16 }))).toBe(false);
});
