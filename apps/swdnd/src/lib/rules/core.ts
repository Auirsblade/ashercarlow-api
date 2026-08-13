// apps/swdnd/src/lib/rules/core.ts
import { ABILITIES } from './constants';
import type { AbilityKey, CharacterBuild, DeploymentEntry } from './types';

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function totalLevel(build: CharacterBuild): number {
  return build.levels.length;
}

export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(level, 1) - 1) / 4);
}

export function totalAbilityScores(build: CharacterBuild): Record<AbilityKey, number> {
  const out = { ...build.abilities.base } as Record<AbilityKey, number>;
  for (const key of ABILITIES) out[key] = build.abilities.base[key] ?? 10;
  for (const inc of build.abilities.increases) {
    out[inc.ability] = (out[inc.ability] ?? 10) + inc.amount;
  }
  return out;
}

export interface ClassTaken {
  classId: string;
  archetypeId: string | null;
  levels: number;
}

/** Group ordered level entries into one record per class, in first-taken order. */
export function classesTaken(build: CharacterBuild): ClassTaken[] {
  const order: string[] = [];
  const map = new Map<string, ClassTaken>();
  for (const lvl of build.levels) {
    let entry = map.get(lvl.classId);
    if (!entry) {
      entry = { classId: lvl.classId, archetypeId: null, levels: 0 };
      map.set(lvl.classId, entry);
      order.push(lvl.classId);
    }
    entry.levels += 1;
    if (entry.archetypeId == null && lvl.archetypeId != null) entry.archetypeId = lvl.archetypeId;
  }
  return order.map((id) => map.get(id)!);
}

/** The entry's ordinal within its own class (Fighter 1, 2, … regardless of interleaving). */
export function classLevelOrdinal(build: CharacterBuild, n: number): number {
  const entry = build.levels.find((l) => l.n === n);
  if (!entry) return 0;
  let count = 0;
  for (const l of build.levels) {
    if (l.classId === entry.classId) count += 1;
    if (l.n === n) break;
  }
  return count;
}

/** Tolerant read: pre-v2 documents have no `deployments` field. */
export function deploymentsOf(build: CharacterBuild): DeploymentEntry[] {
  return build.deployments ?? [];
}

/** Tolerant read: pre-v2 documents have no `prestige` field. */
export function prestigeOf(build: CharacterBuild): number {
  return build.prestige ?? 0;
}
