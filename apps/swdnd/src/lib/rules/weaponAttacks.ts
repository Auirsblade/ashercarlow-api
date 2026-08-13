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
 * finesse (better of STR/DEX); then blaster weaponType (DEX); then a legacy
 * `ran`-truthy fallback for rows with no weaponType; else STR.
 *
 * Property keys are the sw5e short forms (`fin`, `ran`) — verified against the
 * ingested `weapons` rows. `fin` is a plain boolean on every row that has it.
 * `ran` is NOT a reliable ranged flag: ~35 real blaster rows (simpleB/martialB)
 * omit it entirely (their range lives in the prose-only `pcl` property
 * instead), which is why blasters must be routed off `weaponType`, not `ran`.
 * Worse, `ran` doubles as the THROWN range on melee vibro/light weapons (e.g.
 * a vibrodagger's `thr: 'range 20/60'` pairs with `ran: 20`) — so trusting
 * `ran` for those would flip a thrown STR weapon to DEX. `weaponType`'s
 * trailing letter is the weapon class (B = blaster, LW = lightweapon,
 * VW = vibroweapon); the `ran` fallback below is restricted to rows with no
 * melee weaponType (blasters are already resolved above it; what's left is
 * genuinely unknown-type rows, e.g. test fixtures with no weaponType set).
 */
function attackAbility(weapon: RefWeapon, str: number, dex: number): AbilityKey {
  if (weapon.ability) return weapon.ability;
  if (weapon.properties.fin === true) return dex > str ? 'dex' : 'str';
  if (weapon.weaponType.endsWith('B')) return 'dex';
  const isMelee = weapon.weaponType.endsWith('LW') || weapon.weaponType.endsWith('VW');
  if (!isMelee && weapon.properties.ran) return 'dex';
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
