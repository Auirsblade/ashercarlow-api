// apps/swdnd/src/lib/validation.ts
import type { CharacterBuild, DerivedSheet, ReferenceData } from './rules/types';
import { classesTaken, classLevelOrdinal, deploymentsOf, prestigeOf } from './rules/core';

export type StepKey =
  | 'species' | 'background' | 'class' | 'abilities'
  | 'skills' | 'feats' | 'equipment' | 'powers' | 'deployments';
export const STEP_ORDER: StepKey[] = [
  'species', 'background', 'class', 'abilities', 'skills', 'feats', 'equipment', 'powers', 'deployments',
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
  const taken = classesTaken(build);
  let classInfo: StepInfo;
  if (build.levels.length === 0) classInfo = info('untouched', '—');
  else {
    const problems: string[] = [];
    for (const lvl of build.levels) {
      const classLevel = classLevelOrdinal(build, lvl.n);
      if (!(ref.classes[lvl.classId]?.asiLevels ?? []).includes(classLevel)) continue;
      const choice = lvl.choices?.asiOrFeat;
      if (choice === 'asi') {
        const spent = build.abilities.increases
          .filter((i) => i.ref === `l${lvl.n}`)
          .reduce((s, i) => s + i.amount, 0);
        if (spent < 2) problems.push(`L${lvl.n} ASI · ${2 - spent} pt${2 - spent === 1 ? '' : 's'} left`);
      } else if (choice !== 'feat') {
        problems.push(`L${lvl.n} ASI/feat pending`);
      }
    }
    for (const t of taken) {
      if (t.levels >= 3 && !t.archetypeId) {
        problems.push(`${ref.classes[t.classId]?.name ?? t.classId} archetype pending`);
      }
    }
    const summary = taken.map((t) => `${ref.classes[t.classId]?.name ?? t.classId} ${t.levels}`).join(' / ');
    classInfo = problems.length ? info('attention', problems[0]) : info('done', summary);
  }

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

  const featSlots = build.levels.filter((l) => l.n !== 1 && l.choices?.asiOrFeat === 'feat');
  const emptySlots = featSlots.filter((l) => !l.choices?.featId).length;
  const l1FeatId = build.levels[0]?.choices?.featId as string | undefined;
  const featsInfo = emptySlots > 0
    ? info('attention', `${emptySlots} slot${emptySlots === 1 ? '' : 's'} empty`)
    : featSlots.length > 0
      ? info('done', `${featSlots.length + (l1FeatId ? 1 : 0)} feat${featSlots.length + (l1FeatId ? 1 : 0) === 1 ? '' : 's'}`)
      : info('done', l1FeatId ? (ref.feats[l1FeatId]?.name ?? String(l1FeatId)) : 'optional');

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

  // Deployments are optional crew content: they can be empty forever without
  // ever asking for attention. Empty reads 'done'/'optional' (the feats
  // precedent above) rather than 'untouched', so the step never blocks the
  // "all steps complete" badge for non-crew characters. The summary stays
  // reference-free because deployment names live in the on-demand deployment
  // reference, not in ReferenceData — the step component names them.
  const ranked = deploymentsOf(build).filter((d) => d.rank > 0);
  const prestige = prestigeOf(build);
  const deploymentsInfo: StepInfo = ranked.length === 0 && prestige === 0
    ? info('done', 'optional')
    : info('done', `${ranked.length} deployment${ranked.length === 1 ? '' : 's'} · ${prestige} prestige`);

  return {
    species: speciesInfo,
    background: backgroundInfo,
    class: classInfo,
    abilities: abilitiesInfo,
    skills: skillsInfo,
    feats: featsInfo,
    equipment: equipmentInfo,
    powers: powersInfo,
    deployments: deploymentsInfo,
  };
}
