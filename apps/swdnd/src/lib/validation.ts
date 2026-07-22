// apps/swdnd/src/lib/validation.ts
import type { CharacterBuild, DerivedSheet, ReferenceData } from './rules/types';

export type StepKey =
  | 'species' | 'background' | 'class' | 'abilities'
  | 'skills' | 'feats' | 'equipment' | 'powers';
export const STEP_ORDER: StepKey[] = [
  'species', 'background', 'class', 'abilities', 'skills', 'feats', 'equipment', 'powers',
];

export type StepState = 'done' | 'attention' | 'untouched';
export interface StepInfo {
  state: StepState;
  summary: string;
  /** false → the UI hides the step (e.g. Powers for a non-caster non-superiority build). */
  applicable: boolean;
}

const info = (state: StepState, summary: string, applicable = true): StepInfo => ({ state, summary, applicable });

export function stepStatus(
  build: CharacterBuild,
  ref: ReferenceData,
  derived: DerivedSheet,
): Record<StepKey, StepInfo> {
  const houseRuled = new Set(build.houseRuled ?? []);

  // Species: done when chosen AND its free points are fully allocated.
  const species = ref.species[build.identity.speciesId];
  const speciesPoints = species?.abilityIncreases?.points ?? 0;
  const allocated = build.abilities.increases
    .filter((i) => i.ref === `${build.identity.speciesId}#choice`)
    .reduce((s, i) => s + i.amount, 0);
  const speciesInfo = !build.identity.speciesId
    ? info('untouched', '—')
    : allocated < speciesPoints
      ? info('attention', `${species?.name ?? build.identity.speciesId} · ${speciesPoints - allocated} pts left`)
      : info('done', species?.name ?? build.identity.speciesId);

  const background = ref.backgrounds[build.identity.backgroundId];
  const backgroundInfo = build.identity.backgroundId
    ? info('done', background?.name ?? build.identity.backgroundId)
    : info('untouched', '—');

  const classId = build.levels[0]?.classId;
  const cls = classId ? ref.classes[classId] : undefined;
  const classInfo = classId ? info('done', cls?.name ?? classId) : info('untouched', '—');

  const touchedAbilities = Object.values(build.abilities.base).some((v) => v !== 10);
  const abilitiesInfo = touchedAbilities ? info('done', 'set') : info('untouched', '—');

  const needSkills = cls?.skillNumber ?? 0;
  const haveSkills = build.proficiencies.skills.length;
  const skillsInfo =
    haveSkills === 0
      ? info('untouched', needSkills ? `0/${needSkills}` : '—')
      : haveSkills < needSkills
        ? info('attention', `${haveSkills}/${needSkills}`)
        : info('done', `${haveSkills}/${needSkills || haveSkills}`);

  const featId = build.levels[0]?.choices?.featId as string | undefined;
  const featsInfo = info('done', featId ? (ref.feats[featId]?.name ?? String(featId)) : 'optional');

  const equipmentInfo =
    build.equipment.length > 0 || build.credits > 0
      ? info('done', `${build.equipment.length} items · ${build.credits} ₡`)
      : info('untouched', '—');

  // Powers & Maneuvers.
  const force = derived.casting.force;
  const tech = derived.casting.tech;
  const supMax = derived.superiority?.knownMax ?? 0;
  const applicable = force.knownMax > 0 || tech.knownMax > 0 || supMax > 0;
  const forceKnown = build.knownPowers.filter((id) => ref.powers[id]?.castType === 'force').length;
  const techKnown = build.knownPowers.filter((id) => ref.powers[id]?.castType === 'tech').length;
  const manKnown = build.knownManeuvers.length;
  const parts: string[] = [];
  if (force.knownMax > 0) parts.push(`force ${forceKnown}/${force.knownMax}`);
  if (tech.knownMax > 0) parts.push(`tech ${techKnown}/${tech.knownMax}`);
  if (supMax > 0) parts.push(`maneuvers ${manKnown}/${supMax}`);
  const summary = parts.join(' · ') || '—';
  let powersState: StepState;
  const anyPicked = forceKnown + techKnown + manKnown > 0;
  if (!applicable) powersState = 'done';
  else if (houseRuled.has('powers')) powersState = anyPicked ? 'done' : 'untouched';
  else if (!anyPicked) powersState = 'untouched';
  else {
    const exact =
      (force.knownMax === 0 || forceKnown === force.knownMax) &&
      (tech.knownMax === 0 || techKnown === tech.knownMax) &&
      (supMax === 0 || manKnown === supMax) &&
      forceKnown <= force.knownMax && techKnown <= tech.knownMax && manKnown <= supMax;
    powersState = exact ? 'done' : 'attention';
  }
  const powersInfo: StepInfo = { state: powersState, summary, applicable };

  return {
    species: speciesInfo,
    background: backgroundInfo,
    class: classInfo,
    abilities: abilitiesInfo,
    skills: skillsInfo,
    feats: featsInfo,
    equipment: equipmentInfo,
    powers: powersInfo,
  };
}
