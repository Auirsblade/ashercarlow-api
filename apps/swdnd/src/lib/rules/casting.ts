// apps/swdnd/src/lib/rules/casting.ts
import {
  POWER_POINTS_BASE, POWER_MAX_LEVEL, POWER_LIMIT, POWERS_KNOWN, casterWeight,
} from './constants';
import { abilityModifier, classesTaken, proficiencyBonus, totalAbilityScores, totalLevel } from './core';
import type {
  AbilityKey, CastType, CharacterBuild, Progression, ReferenceData, TrackCasting,
} from './types';

type CastProg = Exclude<Progression, 'none'>;
const CAST_TYPES: CastType[] = ['force', 'tech'];

function emptyTrack(): TrackCasting {
  return {
    classes: 0, casterLevel: 0, maxPowerLevel: 0, pointsMax: 0, knownMax: 0,
    ability: null, saveDc: null, attackBonus: null,
  };
}

/** Pick the casting ability for a track, honoring overrides and Force alignment. */
function castingAbility(
  castType: CastType,
  build: CharacterBuild,
  override: AbilityKey | null,
  scores: Record<AbilityKey, number>,
): AbilityKey {
  if (override) return override;
  if (castType === 'tech') return 'int';
  switch (build.identity.alignment) {
    case 'light': return 'wis';
    case 'dark': return 'cha';
    default:
      if (build.identity.forceCastingAbility) return build.identity.forceCastingAbility;
      return abilityModifier(scores.cha) > abilityModifier(scores.wis) ? 'cha' : 'wis';
  }
}

export function computeCasting(
  build: CharacterBuild,
  ref: ReferenceData,
): { force: TrackCasting; tech: TrackCasting } {
  const scores = totalAbilityScores(build);
  const prof = proficiencyBonus(totalLevel(build));
  const out = { force: emptyTrack(), tech: emptyTrack() };

  for (const castType of CAST_TYPES) {
    const track = out[castType];
    let maxClassProg: CastProg | null = null;
    let maxClassLevels = 0;
    let override: AbilityKey | null = null;

    for (const taken of classesTaken(build)) {
      const cls = ref.classes[taken.classId];
      if (!cls) continue;
      const arch = taken.archetypeId ? ref.archetypes[taken.archetypeId] : undefined;
      let prog = (arch?.powercasting?.[castType] ?? 'none') as Progression;
      if (prog === 'none') prog = cls.powercasting[castType] ?? 'none';
      if (prog === 'none') continue;
      if (prog === 'half' && castType === 'tech' && taken.levels < 2) continue;

      const ovr = arch?.powercastingOverride?.[castType] ?? cls.powercastingOverride?.[castType];
      if (ovr) override = ovr;

      const cp = prog as CastProg;
      track.classes += 1;
      track.knownMax += POWERS_KNOWN[castType][cp][taken.levels] ?? 0;
      track.pointsMax += taken.levels * POWER_POINTS_BASE[cp];
      track.casterLevel += taken.levels * casterWeight(cp);
      if (taken.levels > maxClassLevels) {
        maxClassLevels = taken.levels;
        maxClassProg = cp;
      }
    }

    if (castType === 'tech') track.pointsMax /= 2;
    track.pointsMax = Math.round(track.pointsMax);
    track.casterLevel = Math.round(track.casterLevel);

    if (track.classes > 0 && maxClassProg) {
      track.maxPowerLevel = track.classes === 1
        ? POWER_MAX_LEVEL[maxClassProg][maxClassLevels]
        : (POWER_MAX_LEVEL.full[track.casterLevel] ?? 0);

      const ability = castingAbility(castType, build, override, scores);
      const mod = abilityModifier(scores[ability]);
      track.ability = ability;
      track.pointsMax += mod;
      track.saveDc = 8 + prof + mod;
      track.attackBonus = prof + mod;
      // POWER_LIMIT[maxClassProg] is the first power level that's once-per-rest (UI hint, surfaced later).
      void POWER_LIMIT;
    }
  }

  return out;
}
