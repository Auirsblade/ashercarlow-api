// apps/swdnd/src/lib/shipRules/weapons.ts
import { substituteMod } from '../rules/weaponAttacks';
import { ROF_SIZE_MULTIPLIER } from './constants';
import { shipAbilityModifier, totalShipAbilityScores } from './core';
import type { ShipBuild, ShipReferenceData, ShipWeaponProfile, WeaponMount } from './types';

export const DEFAULT_MOUNT: WeaponMount = 'fixed-forward';

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** The ship's contribution to a weapon save DC: 8 + WIS mod. */
export function shipSaveDc(build: ShipBuild): number {
  return 8 + shipAbilityModifier(totalShipAbilityScores(build).wis);
}

/**
 * One profile per installed weapon.
 *
 * SPINE LIMITATION (by design): the attack bonus is the SHIP's part only —
 * WIS mod plus the weapon's own bonus. The gunner's proficiency is a crew stat,
 * so `attackText` carries the literal "+ your proficiency" suffix until the
 * crew layer (sub-project 2) upgrades the engine to take crew inputs.
 */
export function shipWeaponProfiles(build: ShipBuild, ref: ShipReferenceData): ShipWeaponProfile[] {
  const scores = totalShipAbilityScores(build);
  const wisMod = shipAbilityModifier(scores.wis);
  const strMod = shipAbilityModifier(scores.str);
  const saveDc = 8 + wisMod;

  const out: ShipWeaponProfile[] = [];
  for (const entry of build.equipment) {
    if (entry.kind !== 'weapon') continue;
    const w = ref.weapons[entry.ref];
    // 'other' covers the pack's non-installable ammo/simpleVW rows; a build
    // should never reference one as an equipped weapon, but skip defensively.
    if (!w || w.category === 'other') continue;
    const attackShipMod = wisMod + w.attackBonus;
    const [formula, type] = w.damageParts[0] ?? ['', ''];
    out.push({
      entryId: entry.id,
      refId: w.id,
      name: w.name,
      category: w.category,
      mount: entry.mount ?? DEFAULT_MOUNT,
      attackShipMod,
      attackText: `${signed(attackShipMod)} + your proficiency`,
      damageFormula: substituteMod(formula, strMod),
      damageType: type,
      rangeNormal: w.rangeNormal,
      rangeLong: w.rangeLong,
      saveAbility: w.saveAbility,
      saveDc: w.saveAbility ? saveDc : null,
      reload: w.reload,
      usesAmmo: w.usesAmmo,
    });
  }
  return out;
}

/**
 * How many weapons the ship may fire in a round: the Strength modifier
 * (minimum 1) times the size multiplier, rounded up. Display-only in the spine.
 */
export function rateOfFireCap(build: ShipBuild, ref: ShipReferenceData): number {
  const size = ref.sizes[build.identity.sizeId];
  const strMod = shipAbilityModifier(totalShipAbilityScores(build).str);
  const mult = size ? ROF_SIZE_MULTIPLIER[size.key] : 1;
  return Math.max(1, Math.ceil(Math.max(1, strMod) * mult));
}
