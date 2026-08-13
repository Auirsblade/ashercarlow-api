// apps/swdnd/src/lib/shipRules/constants.ts
import type { PowerSystem, RefShipSize, ShipAbilityKey, ShipRole, ShipSizeKey, WeaponMount } from './types';

export const SHIP_ABILITIES: ShipAbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * The six SOTG crew roles. Deliberately static constants rather than a mapped
 * `starship_roles` pack (no such table exists in the ingest); the crew layer
 * (sub-project 2) revisits whether pack rows add data worth mapping.
 */
export const SHIP_ROLES: ShipRole[] = [
  'coordinator', 'gunner', 'mechanic', 'operator', 'pilot', 'technician',
];

export const WEAPON_MOUNTS: WeaponMount[] = [
  'fixed-forward', 'fixed-aft', 'fixed-port', 'fixed-starboard', 'turret',
];

/** SotG system capacitors, in sheet display order. */
export const POWER_SYSTEMS: PowerSystem[] = ['comms', 'engines', 'shields', 'sensors', 'weapons'];

export const MAX_SHIP_TIER = 5;
export const MAX_SYSTEM_DAMAGE = 6;

/**
 * AC bonus by tier. Source: the ingested `starship_features` row "Armor Class
 * Improvement" — "+1 at 2nd Tier … +2 at 3rd Tier, +3 at 4th Tier, +4 at 5th
 * Tier. Applies to all ship sizes."
 */
export const TIER_AC_BONUS: number[] = [0, 0, 1, 2, 3, 4];

/** Verified against the ingested starship_sizes rows (system.hullDice). */
export const HULL_DIE_BY_SIZE: Record<ShipSizeKey, number> = {
  tiny: 4, small: 6, medium: 8, large: 10, huge: 12, gargantuan: 20,
};

/**
 * SOTG rate-of-fire size multiplier (result rounded up, min 1 Str mod). Not
 * pack-sourced — the ingest has no rate-of-fire table. Source: SOTG 2.0
 * Chapter 7 rules text (Tiny/Small 1, Medium 1.5, Large 2.5, Huge 2,
 * Gargantuan 3, round up). The non-monotonic Large > Huge value is
 * intentional — that's genuinely what the book says.
 */
export const ROF_SIZE_MULTIPLIER: Record<ShipSizeKey, number> = {
  tiny: 1, small: 1, medium: 1.5, large: 2.5, huge: 2, gargantuan: 3,
};

export const SHIP_CONDITIONS: string[] = ['Ionized', 'Shocked', 'Tractored', 'Stalled'];
export const LEVELED_SHIP_CONDITIONS: string[] = ['Slowed'];
export const MAX_CONDITION_LEVEL = 4;

/** Every condition the ship conditions menu offers, levelled ones expanded. */
export function shipConditionOptions(): string[] {
  const levelled = LEVELED_SHIP_CONDITIONS.flatMap((c) =>
    Array.from({ length: MAX_CONDITION_LEVEL }, (_, i) => `${c} ${i + 1}`),
  );
  return [...SHIP_CONDITIONS, ...levelled].sort((a, b) => a.localeCompare(b));
}

/**
 * Total of N dice: max on the first, average-rounded-up on the rest — the same
 * rule characters use for HP. Verified against every size row's
 * `hullDiceRolled` array (e.g. Medium `[8,5,5,5,5]` = diceTotal(8, 5) = 28).
 */
export function diceTotal(die: number, count: number): number {
  if (count <= 0) return 0;
  return die + (count - 1) * (Math.floor(die / 2) + 1);
}

/**
 * Starting dice from the size row, plus per-tier growth. Huge and Gargantuan
 * gain 2 dice per tier; every other size gains 1. Controller ruling: the
 * vendor SW5E engine governs over the brief's flat +1 formula here — see
 * `vendor/sw5e/module/documents/actor/actor.mjs:777,802,809`
 * (`(hugeOrGrg ? 2 : 1) * tiers`), corroborated at `:2880` and `:3432`.
 */
function diceGrowthPerTier(size: RefShipSize): number {
  return size.key === 'huge' || size.key === 'gargantuan' ? 2 : 1;
}
export function hullDiceCount(size: RefShipSize, tier: number): number {
  return size.hullDiceStart + diceGrowthPerTier(size) * Math.max(0, tier);
}
export function shieldDiceCount(size: RefShipSize, tier: number): number {
  return size.shieldDiceStart + diceGrowthPerTier(size) * Math.max(0, tier);
}

/**
 * VERIFY STEP (Task 9 brief, Step 1) — outcome: the ingested pack (data/swdnd.sqlite,
 * tables starship_sizes/starship_features/starship_modifications) encodes no
 * hardpoint-count-by-tier formula. `hardpointMult` per size IS in the pack and
 * matches the brief exactly (tiny 1, small 1, medium 1.5, large 2, huge 2,
 * gargantuan 3); every "hardpoint" prose hit is on individual weapons/mods
 * describing what a hardpoint does, not how many a ship gets. No table/row
 * ties hardpoint count to tier. Per the brief, using the stated default:
 * `ceil(hardpointMult * (tier + 1))`.
 *
 * Note for future reference: the vendor SW5E Foundry system source
 * (vendor/sw5e/module/documents/actor/actor.mjs:1432 —
 * `attr.mods.hardpoint.max += (sizeData.hardpointMult ?? 1) * Math.max(1, abl.str.mod)`)
 * implements this as STR-modifier-scaled, not tier-scaled. That engine file is
 * outside the pack this verify step was scoped to (data/swdnd.sqlite) and the
 * `(size, tier)` signature here is the fixed contract downstream tasks
 * (14-16, 20) depend on, so it is not incorporated — flagging for the plan
 * owner since it's a real discrepancy, not a guess. Warn-don't-block only.
 */
export function hardpointBudget(size: RefShipSize, tier: number): number {
  return Math.ceil(size.hardpointMult * (Math.max(0, tier) + 1));
}

/**
 * VERIFY STEP outcome: the pack encodes no modification-slot-count-by-tier
 * formula anywhere (grepped starship_sizes/starship_features/starship_modifications
 * raw_json for "modification slot" / "mod slot" / "slots per" / "per tier" —
 * the only hit, "Equipment Room" adding 4 slots, is itself a suite mod effect,
 * not a base formula). Using the brief's stated default: one modification slot
 * per tier, from one at tier 0. Warn-don't-block only.
 */
export function modSlotBudget(tier: number): number {
  return Math.max(0, tier) + 1;
}

/**
 * VERIFY STEP outcome: CONFIRMED against the ingested starship_sizes rows —
 * `modMaxSuitesBase` / `modMaxSuitesMult` per size exactly match the brief:
 * tiny 0/0 (never gets a suite), small -1/1 (first suite at tier 2), medium
 * 3/1, large 3/2, huge 6/3, gargantuan 10/4. Suites from the size row:
 * `modMaxSuitesBase + modMaxSuitesMult × tier`, floored at 0.
 *
 * Note for future reference: as with hardpointBudget above, the vendor SW5E
 * engine (actor.mjs:1426) scales the multiplier by CON modifier, not tier —
 * `attr.mods.suite.max += (sizeData.modMaxSuitesMult ?? 1) * abl.con.mod`.
 * Kept tier-scaled per the brief's fixed `(size, tier)` signature; flagging
 * the same discrepancy for the plan owner. Warn-don't-block only.
 */
export function suiteBudget(size: RefShipSize, tier: number): number {
  return Math.max(0, size.modMaxSuitesBase + size.modMaxSuitesMult * Math.max(0, tier));
}
