// apps/swdnd/src/lib/shipRules/weapons.ts
import { substituteMod } from '../rules/weaponAttacks';
import { ROF_SIZE_MULTIPLIER } from './constants';
import { shipAbilityModifier, totalShipAbilityScores } from './core';
import type { CrewInput, ShipBuild, ShipReferenceData, ShipWeaponProfile, WeaponMount } from './types';

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
 * `attackShipMod` stays the SHIP's part only — WIS mod plus the weapon's own
 * bonus — so the display can still render the spine's breakdown. `attackText`
 * is engine-conditional: with no gunner deployed it keeps the spine's literal
 * "+ your proficiency" suffix, but once `crewProficiencyApplied` is true the
 * bonus is complete, so `attackText` renders the whole signed `attackBonus`
 * instead (controller ruling, review round 1 — no suffix left to fill in).
 * `saveDc`'s `8 + WIS` fallback also folds in the deployed gunner's
 * proficiency when `crew` is supplied; a flat pack `saveDc` is left untouched
 * either way (controller ruling: crew proficiency never modifies an explicit
 * pack DC).
 */
export function shipWeaponProfiles(build: ShipBuild, ref: ShipReferenceData, crew?: CrewInput): ShipWeaponProfile[] {
  const scores = totalShipAbilityScores(build);
  const wisMod = shipAbilityModifier(scores.wis);
  const strMod = shipAbilityModifier(scores.str);
  const gunnerProficiency = crew?.proficiencyByRole.gunner;
  const crewProficiencyApplied = typeof gunnerProficiency === 'number';
  const prof = gunnerProficiency ?? 0;

  const out: ShipWeaponProfile[] = [];
  for (const entry of build.equipment) {
    if (entry.kind !== 'weapon') continue;
    const w = ref.weapons[entry.ref];
    // 'other' covers the pack's non-installable ammo/simpleVW rows; a build
    // should never reference one as an equipped weapon, but skip defensively.
    if (!w || w.category === 'other') continue;
    const attackShipMod = wisMod + w.attackBonus;
    const attackBonus = attackShipMod + prof;
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
      // A deployed gunner completes the bonus — no more "+ your proficiency"
      // suffix to fill in, since attackBonus is now the whole number. With no
      // gunner aboard, the spine's literal suffix still stands (controller
      // ruling, review round 1).
      attackText: crewProficiencyApplied ? signed(attackBonus) : `${signed(attackShipMod)} + your proficiency`,
      attackBonus,
      crewProficiencyApplied,
      damageFormula,
      damageType: type,
      rangeNormal: w.rangeNormal,
      rangeLong: w.rangeLong,
      saveAbility: w.saveAbility,
      // The pack's own DC governs when the row carries one (e.g. a flat-scaling
      // ion cannon printed at DC 13, independent of the ship's WIS); crew
      // proficiency composes only into the 8 + WIS mod fallback for rows that
      // omit it — it never modifies a flat pack DC (controller ruling).
      saveDc: w.saveAbility ? (w.saveDc ?? (8 + wisMod + prof)) : null,
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
