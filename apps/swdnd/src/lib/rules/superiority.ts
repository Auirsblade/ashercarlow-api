// apps/swdnd/src/lib/rules/superiority.ts
import { SUPERIORITY_DICE_QUANT, SUPERIORITY_DIE_SIZE, MANEUVERS_KNOWN } from './constants';
import { classesTaken } from './core';
import type { CharacterBuild, ReferenceData, SuperiorityBlock } from './types';

export function computeSuperiority(
  build: CharacterBuild,
  ref: ReferenceData,
): SuperiorityBlock | null {
  let level = 0;
  let superiorityClassLevels = 0;
  let diceMax = 0;
  let knownMax = 0;

  for (const taken of classesTaken(build)) {
    const cls = ref.classes[taken.classId];
    if (!cls) continue;
    const arch = taken.archetypeId ? ref.archetypes[taken.archetypeId] : undefined;
    const progression = Math.max(cls.superiorityProgression ?? 0, arch?.superiorityProgression ?? 0);
    if (!progression) continue;

    level += taken.levels * progression;
    superiorityClassLevels += taken.levels;
    diceMax += Math.round((SUPERIORITY_DICE_QUANT[taken.levels] ?? 0) * progression);
    knownMax += MANEUVERS_KNOWN[Math.round(taken.levels * progression)] ?? 0;
  }

  if (superiorityClassLevels === 0) return null;
  return {
    level: Math.round(level),
    diceMax,
    die: SUPERIORITY_DIE_SIZE[superiorityClassLevels] ?? '',
    knownMax,
  };
}
