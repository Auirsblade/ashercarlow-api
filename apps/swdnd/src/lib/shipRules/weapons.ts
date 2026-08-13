// apps/swdnd/src/lib/shipRules/weapons.ts
import { substituteMod } from '../rules/weaponAttacks';
import { ROF_SIZE_MULTIPLIER } from './constants';
import { shipAbilityModifier, totalShipAbilityScores } from './core';
import type { ShipBuild, ShipReferenceData, ShipWeaponProfile, WeaponMount } from './types';

export const DEFAULT_MOUNT: WeaponMount = 'fixed-forward';

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Replace the ship pack's half-STR damage rider `(@strmod/2)` with its
 * floor-rounded integer value, inlined as a plain signed constant term.
 * lib/dice.ts's parseFormula grammar has no parens/division support, so this
 * cannot be left as `(N/2)` -- it must be pre-computed here. Same shape as
 * weaponAttacks.ts's substituteMod, applied AFTER it: some ship weapon
 * formulas reference both `@mod` (full STR, substituted by substituteMod)
 * and `(@strmod/2)` (an additional half-STR rider) in the same string, e.g.
 * '1d8 + @mod + (@strmod/2)'.
 */
function substituteStrMod(formula: string, strMod: number): string {
  if (!formula.includes('@strmod')) return formula;
  const half = Math.floor(strMod / 2);
  if (half === 0) return formula.replace(/\s*[+-]\s*\(@strmod\/2\)/, '').replace(/\(@strmod\/2\)/g, '0').trim();
  const abs = Math.abs(half);
  return formula
    .replace(/[+-]\s*\(@strmod\/2\)/, half > 0 ? `+ ${abs}` : `- ${abs}`)
    .replace(/\(@strmod\/2\)/g, String(half))
    .trim();
}

/** The pack's placeholder for ammo-driven weapons whose damage comes from the
 * loaded ammo item, not the launcher itself (e.g. torpedo/missile launchers). */
const ZERO_BASE_DICE = /^0d\d+/i;

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

  const out: ShipWeaponProfile[] = [];
  for (const entry of build.equipment) {
    if (entry.kind !== 'weapon') continue;
    const w = ref.weapons[entry.ref];
    // 'other' covers the pack's non-installable ammo/simpleVW rows; a build
    // should never reference one as an equipped weapon, but skip defensively.
    if (!w || w.category === 'other') continue;
    const attackShipMod = wisMod + w.attackBonus;
    const [rawFormula, type] = w.damageParts[0] ?? ['', ''];
    // Ammo-driven weapons carry a 0dN placeholder formula -- their damage
    // comes from the loaded ammo item, not the launcher, so there is no
    // formula to roll here. Emit '' rather than a "0d0 + N" string that
    // parseFormula would reject anyway (a dead damage button).
    const damageFormula = ZERO_BASE_DICE.test(rawFormula.trim())
      ? ''
      : substituteStrMod(substituteMod(rawFormula, strMod), strMod);
    out.push({
      entryId: entry.id,
      refId: w.id,
      name: w.name,
      category: w.category,
      mount: entry.mount ?? DEFAULT_MOUNT,
      attackShipMod,
      attackText: `${signed(attackShipMod)} + your proficiency`,
      damageFormula,
      damageType: type,
      rangeNormal: w.rangeNormal,
      rangeLong: w.rangeLong,
      saveAbility: w.saveAbility,
      // The pack's own DC governs when the row carries one (e.g. a flat-scaling
      // ion cannon printed at DC 13, independent of the ship's WIS); the spec
      // formula (8 + WIS mod) is only a fallback for rows that omit it.
      saveDc: w.saveAbility ? (w.saveDc ?? (8 + wisMod)) : null,
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
