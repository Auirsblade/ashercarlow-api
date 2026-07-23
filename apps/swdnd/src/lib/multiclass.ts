// apps/swdnd/src/lib/multiclass.ts
import { MULTICLASS_PRIMARY } from './rules/constants';
import { classesTaken, totalAbilityScores } from './rules/core';
import type { CharacterBuild, ReferenceData } from './rules/types';

/**
 * sw5e multiclass prerequisites: taking a level in a NEW class needs 13+ in the
 * primary ability of the new class AND of every class already taken. Returns
 * human-readable blockers; empty = allowed. First class and same-class levels
 * are always allowed; unknown class data fails open.
 */
export function multiclassBlockers(build: CharacterBuild, ref: ReferenceData, classId: string): string[] {
  const taken = classesTaken(build);
  if (taken.length === 0 || taken.some((t) => t.classId === classId)) return [];
  const scores = totalAbilityScores(build);
  const blockers: string[] = [];
  for (const id of [classId, ...taken.map((t) => t.classId)]) {
    const cls = ref.classes[id];
    const primary = cls ? MULTICLASS_PRIMARY[cls.identifier ?? ''] : undefined;
    if (!primary || scores[primary] >= 13) continue;
    blockers.push(`${cls!.name} needs ${primary.toUpperCase()} 13 — you have ${scores[primary]}`);
  }
  return blockers;
}
