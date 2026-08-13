// apps/swdnd/src/lib/rules/weaponAttacks.ts
import { abilityModifier, totalAbilityScores } from './core';
import type { AbilityKey, CharacterBuild, DerivedSheet, ReferenceData, RefWeapon } from './types';

export interface WeaponAttack {
  id: string;
  name: string;
  ability: AbilityKey;
  attackBonus: number;
  damageFormula: string;
  damageType: string;
}

/**
 * Replace the sw5e `@mod` placeholder with a signed number:
 * '1d8 + @mod' @ +3 → '1d8 + 3', @ -1 → '1d8 - 1', @ 0 → '1d8'.
 * Exported for shipRules/weapons.ts, whose starship damage parts use the
 * identical `@mod` convention (verified against the ingested pack).
 */
export function substituteMod(formula: string, mod: number): string {
  if (!formula.includes('@mod')) return formula;
  if (mod === 0) return formula.replace(/\s*[+-]\s*@mod/, '').replace(/@mod/g, '0').trim();
  const abs = Math.abs(mod);
  return formula
    .replace(/[+-]\s*@mod/, mod > 0 ? `+ ${abs}` : `- ${abs}`)
    .replace(/@mod/g, String(mod))
    .trim();
}

/**
 * Which ability a weapon attacks with. Explicit `system.ability` wins; then
 * finesse (better of STR/DEX); then ranged (DEX); else STR.
 * Property keys are the sw5e short forms (`fin`, `ran`) — verified against the
 * ingested `weapons` rows. `fin` is a plain boolean on every row that has it.
 * `ran` is NOT a boolean flag: on 93/101 rows it holds the weapon's range in
 * feet (e.g. `40`, `100`); only 8 outlier rows use literal `true`. Treat it as
 * truthy (present/nonzero = ranged), never `=== true`, or blaster-type
 * weapons silently fall through to STR.
 */
function attackAbility(weapon: RefWeapon, str: number, dex: number): AbilityKey {
  if (weapon.ability) return weapon.ability;
  if (weapon.properties.fin === true) return dex > str ? 'dex' : 'str';
  if (weapon.properties.ran) return 'dex';
  return 'str';
}

/** One entry per EQUIPPED weapon, in build order. */
export function weaponAttacks(
  build: CharacterBuild,
  derived: DerivedSheet,
  ref: ReferenceData,
): WeaponAttack[] {
  const scores = totalAbilityScores(build);
  const str = abilityModifier(scores.str);
  const dex = abilityModifier(scores.dex);

  const out: WeaponAttack[] = [];
  for (const entry of build.equipment) {
    if (!entry.equipped) continue;
    const weapon = ref.weapons[entry.ref];
    if (!weapon) continue;
    const ability = attackAbility(weapon, str, dex);
    const mod = derived.abilities[ability]?.mod ?? 0;
    const [formula, type] = weapon.damageParts[0] ?? ['', ''];
    out.push({
      id: weapon.id,
      name: weapon.name,
      ability,
      attackBonus: mod + derived.proficiencyBonus + weapon.attackBonus,
      damageFormula: substituteMod(formula, mod),
      damageType: type,
    });
  }
  return out;
}
