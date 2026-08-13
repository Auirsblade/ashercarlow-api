// apps/swdnd/src/lib/buildState.ts
import type {
  AbilityKey, CharacterBuild, DeploymentEntry, DerivedSheet, ReferenceData, SkillKey,
} from './rules/types';
import { maxHp } from './rules/combat';
import { classLevelOrdinal, deploymentsOf, totalAbilityScores } from './rules/core';
import { multiclassBlockers } from './multiclass';

export type BuildAction =
  | { t: 'setName'; name: string }
  | { t: 'setSpecies'; speciesId: string }
  | { t: 'allocateSpeciesPoint'; ability: AbilityKey; delta: 1 | -1 }
  | { t: 'setBackground'; backgroundId: string }
  | { t: 'setClass'; classId: string }
  | { t: 'setBaseAbilities'; base: Record<AbilityKey, number> }
  | { t: 'toggleSkill'; skill: SkillKey }
  | { t: 'addEquipment'; ref: string }
  | { t: 'removeEquipment'; ref: string }
  | { t: 'toggleEquipped'; ref: string }
  | { t: 'setCredits'; credits: number }
  | { t: 'togglePower'; powerId: string }
  | { t: 'toggleManeuver'; maneuverId: string }
  | { t: 'toggleHouseRule'; step: string }
  | { t: 'addLevel'; classId: string }
  | { t: 'removeLastLevel' }
  | { t: 'setLevelHp'; n: number; hp: 'avg' | number }
  | { t: 'setAsiChoice'; n: number; choice: 'asi' | 'feat' | null }
  | { t: 'allocateAsiPoint'; n: number; ability: AbilityKey; delta: 1 | -1 }
  | { t: 'setFeatForLevel'; n: number; featId: string | null }
  | { t: 'setArchetype'; classId: string; archetypeId: string | null }
  | { t: 'setDeploymentRank'; deploymentId: string; rank: number }
  | { t: 'setPrestige'; prestige: number };

const clone = (b: CharacterBuild): CharacterBuild => ({
  ...b,
  identity: { ...b.identity },
  abilities: { base: { ...b.abilities.base }, increases: [...b.abilities.increases] },
  levels: b.levels.map((l) => ({ ...l, choices: { ...(l.choices ?? {}) } })),
  proficiencies: {
    ...b.proficiencies,
    skills: [...b.proficiencies.skills],
    expertise: [...b.proficiencies.expertise],
    tools: [...b.proficiencies.tools],
    languages: [...b.proficiencies.languages],
    savingThrows: [...b.proficiencies.savingThrows],
  },
  equipment: b.equipment.map((e) => ({ ...e })),
  knownPowers: [...b.knownPowers],
  knownManeuvers: [...b.knownManeuvers],
  // play/overrides aren't touched by any build action today, but clone them so
  // future actions (Phase 4 ASIs/overrides) can't mutate the caller's build.
  play: { ...b.play, conditions: [...b.play.conditions] },
  overrides: { ...b.overrides },
  houseRuled: [...(b.houseRuled ?? [])],
  deployments: deploymentsOf(b).map((d) => ({ ...d })),
});

const houseRuled = (b: CharacterBuild, step: string) => (b.houseRuled ?? []).includes(step);

/** Shift play.hp by the maxHp delta since `before`, clamped to 0..newMax (spec §6). */
function applyHpDelta(b: CharacterBuild, ref: ReferenceData, before: number): void {
  const after = maxHp(b, ref);
  b.play.hp = Math.max(0, Math.min(after, b.play.hp + (after - before)));
}

export function applyBuildAction(
  build: CharacterBuild,
  ref: ReferenceData,
  derived: DerivedSheet,
  action: BuildAction,
): CharacterBuild {
  const b = clone(build);

  switch (action.t) {
    case 'setName':
      b.identity.name = action.name;
      break;

    case 'setSpecies': {
      b.identity.speciesId = action.speciesId;
      // Replace ALL species-sourced increases with the new species' fixed ones.
      b.abilities.increases = b.abilities.increases.filter((i) => i.source !== 'species');
      const inc = ref.species[action.speciesId]?.abilityIncreases;
      for (const [ability, amount] of Object.entries(inc?.fixed ?? {})) {
        b.abilities.increases.push({
          source: 'species', ref: action.speciesId, ability: ability as AbilityKey, amount: amount as number,
        });
      }
      break;
    }

    case 'allocateSpeciesPoint': {
      const speciesId = b.identity.speciesId;
      const budget = ref.species[speciesId]?.abilityIncreases?.points ?? 0;
      const choiceRef = `${speciesId}#choice`;
      const allocated = b.abilities.increases.filter((i) => i.ref === choiceRef);
      if (action.delta === 1) {
        if (allocated.reduce((s, i) => s + i.amount, 0) >= budget) break; // budget spent
        b.abilities.increases.push({ source: 'species', ref: choiceRef, ability: action.ability, amount: 1 });
      } else {
        const idx = b.abilities.increases.findIndex((i) => i.ref === choiceRef && i.ability === action.ability);
        if (idx >= 0) b.abilities.increases.splice(idx, 1);
      }
      break;
    }

    case 'setBackground':
      b.identity.backgroundId = action.backgroundId;
      break;

    case 'setClass': {
      const before = maxHp(build, ref);
      b.levels = [{ n: 1, classId: action.classId, archetypeId: null, hp: 'avg', choices: {} }];
      b.proficiencies.savingThrows = [...(ref.classes[action.classId]?.saves ?? [])];
      applyHpDelta(b, ref, before);
      break;
    }

    case 'setBaseAbilities':
      b.abilities.base = { ...action.base };
      break;

    case 'toggleSkill': {
      const i = b.proficiencies.skills.indexOf(action.skill);
      if (i >= 0) b.proficiencies.skills.splice(i, 1);
      else b.proficiencies.skills.push(action.skill);
      break;
    }

    case 'addEquipment': {
      const existing = b.equipment.find((e) => e.ref === action.ref);
      if (existing) existing.qty += 1;
      else b.equipment.push({ ref: action.ref, qty: 1, equipped: true });
      break;
    }
    case 'removeEquipment': {
      const idx = b.equipment.findIndex((e) => e.ref === action.ref);
      if (idx < 0) break;
      if (b.equipment[idx].qty > 1) b.equipment[idx].qty -= 1;
      else b.equipment.splice(idx, 1);
      break;
    }
    case 'toggleEquipped': {
      const item = b.equipment.find((e) => e.ref === action.ref);
      if (item) item.equipped = !item.equipped;
      break;
    }
    case 'setCredits':
      b.credits = Math.max(0, action.credits);
      break;

    case 'togglePower': {
      const idx = b.knownPowers.indexOf(action.powerId);
      if (idx >= 0) { b.knownPowers.splice(idx, 1); break; } // removal always allowed
      const power = ref.powers[action.powerId];
      if (!power) break;
      if (!houseRuled(b, 'powers')) {
        const track = derived.casting[power.castType];
        const sameTrackKnown = b.knownPowers.filter((id) => ref.powers[id]?.castType === power.castType).length;
        if (track.classes === 0) break;
        if (power.level > track.maxPowerLevel) break;
        if (sameTrackKnown >= track.knownMax) break;
      }
      b.knownPowers.push(action.powerId);
      break;
    }

    case 'toggleManeuver': {
      const idx = b.knownManeuvers.indexOf(action.maneuverId);
      if (idx >= 0) { b.knownManeuvers.splice(idx, 1); break; }
      if (!houseRuled(b, 'powers')) {
        const cap = derived.superiority?.knownMax ?? 0;
        if (b.knownManeuvers.length >= cap) break;
      }
      b.knownManeuvers.push(action.maneuverId);
      break;
    }

    case 'toggleHouseRule': {
      const list = b.houseRuled ?? [];
      const i = list.indexOf(action.step);
      if (i >= 0) list.splice(i, 1);
      else list.push(action.step);
      b.houseRuled = list;
      break;
    }

    case 'addLevel': {
      if (b.levels.length >= 20 || !ref.classes[action.classId]) break;
      if (!houseRuled(b, 'class') && multiclassBlockers(b, ref, action.classId).length > 0) break;
      const before = maxHp(build, ref);
      if (b.levels.length === 0) b.proficiencies.savingThrows = [...(ref.classes[action.classId]?.saves ?? [])];
      b.levels.push({ n: b.levels.length + 1, classId: action.classId, archetypeId: null, hp: 'avg', choices: {} });
      applyHpDelta(b, ref, before);
      break;
    }

    case 'removeLastLevel': {
      const last = b.levels[b.levels.length - 1];
      if (!last) break;
      // Ability-driven max changes move max only: strip this level's increases
      // FIRST, then measure only the level's own HP contribution (round-trips addLevel).
      b.abilities.increases = b.abilities.increases.filter((i) => i.ref !== `l${last.n}`);
      const before = maxHp(b, ref);
      b.levels.pop();
      if (b.levels.length === 0) b.proficiencies.savingThrows = [];
      applyHpDelta(b, ref, before);
      break;
    }

    case 'setLevelHp': {
      const entry = b.levels.find((l) => l.n === action.n);
      if (!entry || entry.n === 1) break; // level 1 is always max die (engine rule)
      const die = ref.classes[entry.classId]?.hitDie ?? 6;
      const before = maxHp(build, ref);
      entry.hp = action.hp === 'avg' ? 'avg' : Math.min(Math.max(1, Math.round(action.hp)), die);
      applyHpDelta(b, ref, before);
      break;
    }

    case 'setAsiChoice': {
      const entry = b.levels.find((l) => l.n === action.n);
      if (!entry) break;
      if (!(ref.classes[entry.classId]?.asiLevels ?? []).includes(classLevelOrdinal(b, action.n))) break;
      const prev = entry.choices?.asiOrFeat;
      entry.choices = { ...(entry.choices ?? {}) };
      if (action.choice === null) delete entry.choices.asiOrFeat;
      else entry.choices.asiOrFeat = action.choice;
      // Switching elections clears the other election's grants (spec §2).
      if (prev === 'asi' && action.choice !== 'asi') {
        b.abilities.increases = b.abilities.increases.filter((i) => i.ref !== `l${action.n}`);
      }
      if (prev === 'feat' && action.choice !== 'feat') delete entry.choices.featId;
      break;
    }

    case 'allocateAsiPoint': {
      const entry = b.levels.find((l) => l.n === action.n);
      if (entry?.choices?.asiOrFeat !== 'asi') break;
      if (!(ref.classes[entry.classId]?.asiLevels ?? []).includes(classLevelOrdinal(b, action.n))) break;
      const asiRef = `l${action.n}`;
      if (action.delta === -1) {
        const idx = b.abilities.increases.findIndex((i) => i.ref === asiRef && i.ability === action.ability);
        if (idx >= 0) b.abilities.increases.splice(idx, 1);
        break;
      }
      const spent = b.abilities.increases.filter((i) => i.ref === asiRef).reduce((s, i) => s + i.amount, 0);
      if (spent >= 2) break;                                    // ASI budget is 2 points
      if (totalAbilityScores(b)[action.ability] >= 20) break;   // sw5e hard cap
      b.abilities.increases.push({ source: 'asi', ref: asiRef, ability: action.ability, amount: 1 });
      break;
    }

    case 'setFeatForLevel': {
      const entry = b.levels.find((l) => l.n === action.n);
      if (!entry) break;
      // L1's feat is the optional Phase 3 slot; other levels need a 'feat' election.
      if (action.n !== 1 && entry.choices?.asiOrFeat !== 'feat') break;
      entry.choices = { ...(entry.choices ?? {}) };
      if (action.featId == null) delete entry.choices.featId;
      else entry.choices.featId = action.featId;
      break;
    }

    case 'setArchetype': {
      // The archetype lives on the entry where the class reaches level 3
      // (the engine's classesTaken reads the first non-null per class).
      let classLevel = 0;
      let target: (typeof b.levels)[number] | undefined;
      for (const l of b.levels) {
        if (l.classId !== action.classId) continue;
        classLevel += 1;
        if (classLevel === 3) { target = l; break; }
      }
      if (!target) break;
      if (action.archetypeId != null) {
        const arch = ref.archetypes[action.archetypeId];
        if (!arch) break;
        if (!houseRuled(b, 'class') && arch.classIdentifier !== ref.classes[action.classId]?.identifier) break;
      }
      for (const l of b.levels) if (l.classId === action.classId) l.archetypeId = null;
      target.archetypeId = action.archetypeId;
      break;
    }

    case 'setDeploymentRank': {
      const rank = Math.max(0, Math.min(5, Math.trunc(action.rank)));
      const kept: DeploymentEntry[] = deploymentsOf(b).filter((d) => d.deploymentId !== action.deploymentId);
      // Rank 0 is "not deployed": the entry is dropped rather than stored as a zero.
      b.deployments = rank > 0 ? [...kept, { deploymentId: action.deploymentId, rank }] : kept;
      break;
    }

    case 'setPrestige':
      b.prestige = Math.max(0, Math.trunc(action.prestige));
      break;
  }
  return b;
}
