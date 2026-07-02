// apps/swdnd/src/lib/rules/index.ts
import { ABILITIES } from './constants';
import { computeCasting } from './casting';
import { armorClass, hitDice, initiative, maxHp, speed } from './combat';
import { abilityModifier, proficiencyBonus, totalAbilityScores, totalLevel } from './core';
import { savingThrows, skillBonuses } from './skills';
import { computeSuperiority } from './superiority';
import type { AbilityBlock, AbilityKey, CharacterBuild, DerivedSheet, ReferenceData } from './types';

export * from './types';

/** Overridable scalar fields. If `build.overrides[field]` is a number, it wins. */
const OVERRIDABLE = ['maxHp', 'armorClass', 'initiative', 'speed'] as const;
type Overridable = (typeof OVERRIDABLE)[number];

function applyOverride(build: CharacterBuild, field: Overridable, computed: number): number {
  const o = build.overrides[field];
  return typeof o === 'number' ? o : computed;
}

export function computeSheet(build: CharacterBuild, ref: ReferenceData): DerivedSheet {
  const scores = totalAbilityScores(build);
  const level = totalLevel(build);

  const abilities = {} as Record<AbilityKey, AbilityBlock>;
  for (const key of ABILITIES) {
    abilities[key] = { score: scores[key], mod: abilityModifier(scores[key]) };
  }

  return {
    totalLevel: level,
    proficiencyBonus: proficiencyBonus(level),
    abilities,
    maxHp: applyOverride(build, 'maxHp', maxHp(build, ref)),
    armorClass: applyOverride(build, 'armorClass', armorClass(build, ref)),
    initiative: applyOverride(build, 'initiative', initiative(build)),
    speed: applyOverride(build, 'speed', speed(build, ref)),
    hitDice: hitDice(build, ref),
    savingThrows: savingThrows(build),
    skills: skillBonuses(build),
    casting: computeCasting(build, ref),
    superiority: computeSuperiority(build, ref),
  };
}
