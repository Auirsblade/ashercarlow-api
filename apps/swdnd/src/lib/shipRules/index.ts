// apps/swdnd/src/lib/shipRules/index.ts
import { SHIP_ABILITIES, hardpointBudget, modSlotBudget, suiteBudget } from './constants';
import { shipAbilityModifier, shipTier, totalShipAbilityScores } from './core';
import {
  maxHull, maxShields, shieldRegen, shipArmorClass, shipDamageReduction, shipHullDice, shipShieldDice,
} from './defense';
import { shipSpeed, shipTurnSpeed } from './movement';
import { rateOfFireCap, shipWeaponProfiles } from './weapons';
import type { DerivedShip, ShipAbilityBlock, ShipAbilityKey, ShipBuild, ShipReferenceData } from './types';

export * from './types';

/** Overridable scalar fields. If `build.overrides[field]` is a number, it wins. */
export const OVERRIDABLE_SHIP = ['maxHull', 'maxShields', 'armorClass', 'speed', 'turnSpeed'] as const;
type OverridableShip = (typeof OVERRIDABLE_SHIP)[number];

function applyOverride(build: ShipBuild, field: OverridableShip, computed: number): number {
  const o = build.overrides[field];
  return typeof o === 'number' ? o : computed;
}

/**
 * The whole derived ship. Pure, synchronous, frontend-only, and SHIP-ONLY:
 * no crew inputs (see shipRules/weapons.ts for the deferred proficiency).
 */
export function computeShip(build: ShipBuild, ref: ShipReferenceData): DerivedShip {
  const scores = totalShipAbilityScores(build);
  const tier = shipTier(build);
  const size = ref.sizes[build.identity.sizeId];

  const abilities = {} as Record<ShipAbilityKey, ShipAbilityBlock>;
  for (const key of SHIP_ABILITIES) {
    abilities[key] = { score: scores[key], mod: shipAbilityModifier(scores[key]) };
  }

  // Suite modifications consume a suite; every other system consumes a slot.
  const mods = build.modifications.map((id) => ref.modifications[id]).filter(Boolean);
  const suitesUsed = mods.filter((m) => m.system === 'Suite' && !m.freeSuite).length;
  const modSlotsUsed = mods.filter((m) => m.system !== 'Suite' && !m.freeSlot).length;

  return {
    tier,
    abilities,
    armorClass: applyOverride(build, 'armorClass', shipArmorClass(build, ref)),
    damageReduction: shipDamageReduction(build, ref),
    maxHull: applyOverride(build, 'maxHull', maxHull(build, ref)),
    hullDice: shipHullDice(build, ref),
    maxShields: applyOverride(build, 'maxShields', maxShields(build, ref)),
    shieldDice: shipShieldDice(build, ref),
    shieldRegen: shieldRegen(build, ref),
    speed: applyOverride(build, 'speed', shipSpeed(build, ref)),
    turnSpeed: applyOverride(build, 'turnSpeed', shipTurnSpeed(build, ref)),
    weapons: shipWeaponProfiles(build, ref),
    rateOfFireCap: rateOfFireCap(build, ref),
    hardpointsUsed: build.equipment.filter((e) => e.kind === 'weapon').length,
    hardpointsMax: size ? hardpointBudget(size, tier) : 0,
    modSlotsUsed,
    modSlotsMax: modSlotBudget(tier),
    suitesUsed,
    suitesMax: size ? suiteBudget(size, tier) : 0,
  };
}
