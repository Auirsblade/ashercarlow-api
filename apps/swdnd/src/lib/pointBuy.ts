// apps/swdnd/src/lib/pointBuy.ts
// sw5e "Variant: Customizing Ability Scores" (sw5e.com PHB ch.1): 27 points,
// scores 8–15 before species increases.
import type { AbilityKey } from './rules/types';

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const POINT_BUY_COST: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};

/** Cost of one score, or null when outside the 8–15 point-buy range. */
export function scoreCost(score: number): number | null {
  return POINT_BUY_COST[score] ?? null;
}

/** Total points spent, or null when any score is out of range. */
export function pointsSpent(base: Record<AbilityKey, number>): number | null {
  let total = 0;
  for (const score of Object.values(base)) {
    const cost = scoreCost(score);
    if (cost == null) return null;
    total += cost;
  }
  return total;
}

export function budgetRemaining(base: Record<AbilityKey, number>): number | null {
  const spent = pointsSpent(base);
  return spent == null ? null : POINT_BUY_BUDGET - spent;
}

export function isLegalPointBuy(base: Record<AbilityKey, number>): boolean {
  const remaining = budgetRemaining(base);
  return remaining != null && remaining >= 0;
}

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
