// apps/swdnd/src/lib/buildState.ts
import type {
  AbilityKey, CharacterBuild, DerivedSheet, ReferenceData, SkillKey,
} from './rules/types';

export type BuildAction =
  | { t: 'setName'; name: string }
  | { t: 'setSpecies'; speciesId: string }
  | { t: 'allocateSpeciesPoint'; ability: AbilityKey; delta: 1 | -1 }
  | { t: 'setBackground'; backgroundId: string }
  | { t: 'setClass'; classId: string }
  | { t: 'setBaseAbilities'; base: Record<AbilityKey, number> }
  | { t: 'toggleSkill'; skill: SkillKey }
  | { t: 'setFeat'; featId: string | null }
  | { t: 'addEquipment'; ref: string }
  | { t: 'removeEquipment'; ref: string }
  | { t: 'toggleEquipped'; ref: string }
  | { t: 'setCredits'; credits: number }
  | { t: 'togglePower'; powerId: string }
  | { t: 'toggleManeuver'; maneuverId: string }
  | { t: 'toggleHouseRule'; step: string };

const clone = (b: CharacterBuild): CharacterBuild => ({
  ...b,
  identity: { ...b.identity },
  abilities: { base: { ...b.abilities.base }, increases: [...b.abilities.increases] },
  levels: b.levels.map((l) => ({ ...l, choices: { ...(l.choices ?? {}) } })),
  proficiencies: {
    ...b.proficiencies,
    skills: [...b.proficiencies.skills],
    savingThrows: [...b.proficiencies.savingThrows],
  },
  equipment: b.equipment.map((e) => ({ ...e })),
  knownPowers: [...b.knownPowers],
  knownManeuvers: [...b.knownManeuvers],
  houseRuled: [...(b.houseRuled ?? [])],
});

const houseRuled = (b: CharacterBuild, step: string) => (b.houseRuled ?? []).includes(step);

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
      b.levels = [{ n: 1, classId: action.classId, archetypeId: null, hp: 'avg', choices: {} }];
      b.proficiencies.savingThrows = [...(ref.classes[action.classId]?.saves ?? [])];
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

    case 'setFeat': {
      if (b.levels.length === 0) break;
      // Feat-sourced increases are Phase 4 (ASI feats); Phase 3 records the pick.
      if (action.featId == null) delete b.levels[0].choices!.featId;
      else b.levels[0].choices = { ...(b.levels[0].choices ?? {}), featId: action.featId };
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
  }
  return b;
}
