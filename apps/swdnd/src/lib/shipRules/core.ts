// apps/swdnd/src/lib/shipRules/core.ts
import { MAX_SHIP_TIER, SHIP_ABILITIES } from './constants';
import type { ShipAbilityKey, ShipBuild } from './types';

export function shipAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function totalShipAbilityScores(build: ShipBuild): Record<ShipAbilityKey, number> {
  const out = {} as Record<ShipAbilityKey, number>;
  for (const key of SHIP_ABILITIES) out[key] = build.abilities.base[key] ?? 10;
  for (const inc of build.abilities.increases) {
    out[inc.ability] = (out[inc.ability] ?? 10) + inc.amount;
  }
  return out;
}

/** The stored tier, clamped to the SOTG range. */
export function shipTier(build: ShipBuild): number {
  return Math.max(0, Math.min(MAX_SHIP_TIER, Math.floor(build.identity.tier ?? 0)));
}
