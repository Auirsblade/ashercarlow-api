// apps/swdnd/src/lib/shipRules/defense.ts
import { TIER_AC_BONUS, diceTotal, hullDiceCount, shieldDiceCount } from './constants';
import { shipAbilityModifier, shipTier, totalShipAbilityScores } from './core';
import type { RefShipArmor, ShipBuild, ShipReferenceData } from './types';

function installedOf(
  build: ShipBuild, ref: ShipReferenceData, kind: 'armor' | 'shield',
): RefShipArmor | undefined {
  // Both hull armor and shield generators live in the starship_armor table;
  // the build entry's `kind` says which slot the player filled.
  for (const entry of build.equipment) {
    if (entry.kind !== kind) continue;
    const row = ref.armor[entry.ref];
    if (row) return row;
  }
  return undefined;
}

/** The installed hull armor row, or undefined. */
export function installedArmor(build: ShipBuild, ref: ShipReferenceData): RefShipArmor | undefined {
  return installedOf(build, ref, 'armor');
}
/** The installed shield generator row, or undefined. */
export function installedShield(build: ShipBuild, ref: ShipReferenceData): RefShipArmor | undefined {
  return installedOf(build, ref, 'shield');
}

/** 10 (or the armor's base) + Dex mod capped by the armor + the tier AC bonus. */
export function shipArmorClass(build: ShipBuild, ref: ShipReferenceData): number {
  const dexMod = shipAbilityModifier(totalShipAbilityScores(build).dex);
  const armor = installedArmor(build, ref);
  const base = armor?.baseAc ?? 10;
  const dexPart = armor && armor.dexCap != null ? Math.min(dexMod, armor.dexCap) : dexMod;
  return base + dexPart + (TIER_AC_BONUS[shipTier(build)] ?? 0);
}

export function shipDamageReduction(build: ShipBuild, ref: ShipReferenceData): number {
  return installedArmor(build, ref)?.damageReduction ?? 0;
}

export function shipHullDice(build: ShipBuild, ref: ShipReferenceData): { die: number; count: number } {
  const size = ref.sizes[build.identity.sizeId];
  if (!size) return { die: 0, count: 0 };
  return { die: size.hullDie, count: hullDiceCount(size, shipTier(build)) };
}

export function shipShieldDice(build: ShipBuild, ref: ShipReferenceData): { die: number; count: number } {
  const size = ref.sizes[build.identity.sizeId];
  if (!size) return { die: 0, count: 0 };
  return { die: size.shieldDie, count: shieldDiceCount(size, shipTier(build)) };
}

/** Hull dice total + Con modifier per die, floored at 0. */
export function maxHull(build: ShipBuild, ref: ShipReferenceData): number {
  const { die, count } = shipHullDice(build, ref);
  if (count === 0) return 0;
  const conMod = shipAbilityModifier(totalShipAbilityScores(build).con);
  return Math.max(0, diceTotal(die, count) + conMod * count);
}

/**
 * Shield dice total + Str modifier per die, scaled by the installed generator's
 * capacity coefficient (Directional x1, Fortress x3/2, Quick-Charge x2/3).
 * No generator installed -> the ship has no shields at all.
 */
export function maxShields(build: ShipBuild, ref: ShipReferenceData): number {
  const shield = installedShield(build, ref);
  if (!shield) return 0;
  const { die, count } = shipShieldDice(build, ref);
  if (count === 0) return 0;
  const strMod = shipAbilityModifier(totalShipAbilityScores(build).str);
  const base = diceTotal(die, count) + strMod * count;
  return Math.max(0, Math.floor(base * (shield.capacityCoefficient ?? 1)));
}

/**
 * Regen rate = the maximum value of one shield die scaled by the generator's
 * regen coefficient (Directional x1, Fortress x2/3, Quick-Charge x3/2).
 */
export function shieldRegen(build: ShipBuild, ref: ShipReferenceData): number {
  const shield = installedShield(build, ref);
  if (!shield) return 0;
  const { die } = shipShieldDice(build, ref);
  if (die === 0) return 0;
  return Math.max(1, Math.floor(die * (shield.regenCoefficient ?? 1)));
}
