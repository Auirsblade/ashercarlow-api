// apps/swdnd/src/lib/rules/skills.ts
import { ABILITIES, SKILLS } from './constants';
import { abilityModifier, proficiencyBonus, totalAbilityScores, totalLevel } from './core';
import type { AbilityKey, CharacterBuild, SkillBonus, SkillKey } from './types';

export function savingThrows(
  build: CharacterBuild,
): Record<AbilityKey, { bonus: number; proficient: boolean }> {
  const scores = totalAbilityScores(build);
  const prof = proficiencyBonus(totalLevel(build));
  const proficientSet = new Set(build.proficiencies.savingThrows);
  const out = {} as Record<AbilityKey, { bonus: number; proficient: boolean }>;
  for (const key of ABILITIES) {
    const proficient = proficientSet.has(key);
    out[key] = { bonus: abilityModifier(scores[key]) + (proficient ? prof : 0), proficient };
  }
  return out;
}

export function skillBonuses(build: CharacterBuild): SkillBonus[] {
  const scores = totalAbilityScores(build);
  const prof = proficiencyBonus(totalLevel(build));
  const profSet = new Set(build.proficiencies.skills);
  const expSet = new Set(build.proficiencies.expertise);
  return (Object.keys(SKILLS) as SkillKey[]).map((key) => {
    const { ability } = SKILLS[key];
    const proficient = profSet.has(key);
    const expertise = proficient && expSet.has(key);
    const bonus = abilityModifier(scores[ability]) + (proficient ? prof : 0) + (expertise ? prof : 0);
    return { key, ability, bonus, proficient, expertise };
  });
}
