// apps/swdnd/src/lib/buildState.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type DerivedSheet, type ReferenceData, type RefClass, type RefSpecies } from './rules/types';
import { applyBuildAction } from './buildState';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const zabrak: RefSpecies = {
  id: 'zabrak', name: 'Zabrak', walkSpeed: 30, description: '',
  abilityIncreases: { fixed: { con: 2 }, points: 1 },
};
const human: RefSpecies = {
  id: 'human', name: 'Human', walkSpeed: 30, description: '',
  abilityIncreases: { fixed: {}, points: 4 },
};
const ref = {
  classes: { consular }, species: { zabrak, human },
  archetypes: {}, armor: {}, weapons: {},
  powers: {
    push: { id: 'push', name: 'Push', level: 0, castType: 'force', description: '' },
    heal: { id: 'heal', name: 'Heal', level: 1, castType: 'force', description: '' },
    scan: { id: 'scan', name: 'Scan', level: 1, castType: 'tech', description: '' },
    storm: { id: 'storm', name: 'Storm', level: 4, castType: 'force', description: '' },
  },
  backgrounds: {}, feats: {}, maneuvers: {}, gear: {},
} as unknown as ReferenceData;
// A Consular-1-ish derived: force known max 9, max power level 1, no tech, no superiority.
const derived = {
  casting: {
    force: { classes: 1, knownMax: 9, maxPowerLevel: 1 },
    tech: { classes: 0, knownMax: 0, maxPowerLevel: 0 },
  },
  superiority: null,
} as unknown as DerivedSheet;

test('setSpecies applies fixed increases and replaces a prior species entirely', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setSpecies', speciesId: 'zabrak' });
  expect(b.identity.speciesId).toBe('zabrak');
  expect(b.abilities.increases).toEqual([{ source: 'species', ref: 'zabrak', ability: 'con', amount: 2 }]);
  b = applyBuildAction(b, ref, derived, { t: 'allocateSpeciesPoint', ability: 'wis', delta: 1 });
  expect(b.abilities.increases).toContainEqual({ source: 'species', ref: 'zabrak#choice', ability: 'wis', amount: 1 });
  // switching species drops ALL species-sourced increases
  b = applyBuildAction(b, ref, derived, { t: 'setSpecies', speciesId: 'human' });
  expect(b.abilities.increases).toEqual([]);
});

test('allocateSpeciesPoint caps at the species budget and never goes negative', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setSpecies', speciesId: 'zabrak' }); // 1 point
  b = applyBuildAction(b, ref, derived, { t: 'allocateSpeciesPoint', ability: 'wis', delta: 1 });
  const capped = applyBuildAction(b, ref, derived, { t: 'allocateSpeciesPoint', ability: 'cha', delta: 1 });
  expect(capped.abilities.increases.filter((i) => i.ref === 'zabrak#choice')).toHaveLength(1); // no budget left
  const removed = applyBuildAction(b, ref, derived, { t: 'allocateSpeciesPoint', ability: 'wis', delta: -1 });
  expect(removed.abilities.increases.filter((i) => i.ref === 'zabrak#choice')).toHaveLength(0);
});

test('setClass writes levels[0] and saving throws', () => {
  const b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setClass', classId: 'consular' });
  expect(b.levels).toEqual([{ n: 1, classId: 'consular', archetypeId: null, hp: 'avg', choices: {} }]);
  expect(b.proficiencies.savingThrows).toEqual(['wis', 'cha']);
});

test('toggleSkill / setFeat / equipment / credits', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'toggleSkill', skill: 'lor' });
  expect(b.proficiencies.skills).toEqual(['lor']);
  b = applyBuildAction(b, ref, derived, { t: 'toggleSkill', skill: 'lor' });
  expect(b.proficiencies.skills).toEqual([]);
  b = applyBuildAction(b, ref, derived, { t: 'setClass', classId: 'consular' });
  b = applyBuildAction(b, ref, derived, { t: 'setFeat', featId: 'f1' });
  expect(b.levels[0].choices).toEqual({ featId: 'f1' });
  b = applyBuildAction(b, ref, derived, { t: 'addEquipment', ref: 'saber' });
  b = applyBuildAction(b, ref, derived, { t: 'addEquipment', ref: 'saber' });
  expect(b.equipment).toEqual([{ ref: 'saber', qty: 2, equipped: true }]);
  b = applyBuildAction(b, ref, derived, { t: 'removeEquipment', ref: 'saber' });
  expect(b.equipment[0].qty).toBe(1);
  b = applyBuildAction(b, ref, derived, { t: 'setCredits', credits: -5 });
  expect(b.credits).toBe(0);
});

test('togglePower enforces track, level cap, and count cap unless house-ruled', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'togglePower', powerId: 'heal' });
  expect(b.knownPowers).toEqual(['heal']);
  // tech power: no tech track -> rejected
  expect(applyBuildAction(b, ref, derived, { t: 'togglePower', powerId: 'scan' }).knownPowers).toEqual(['heal']);
  // above max power level -> rejected
  expect(applyBuildAction(b, ref, derived, { t: 'togglePower', powerId: 'storm' }).knownPowers).toEqual(['heal']);
  // removal always allowed
  expect(applyBuildAction(b, ref, derived, { t: 'togglePower', powerId: 'heal' }).knownPowers).toEqual([]);
  // house-ruled: anything goes
  b = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'powers' });
  expect(b.houseRuled).toEqual(['powers']);
  expect(applyBuildAction(b, ref, derived, { t: 'togglePower', powerId: 'storm' }).knownPowers).toContain('storm');
});

test('togglePower count cap uses derived knownMax', () => {
  const tiny = { ...derived, casting: { ...derived.casting, force: { ...derived.casting.force, knownMax: 1 } } } as DerivedSheet;
  let b = applyBuildAction(emptyBuild('x'), ref, tiny, { t: 'togglePower', powerId: 'heal' });
  expect(applyBuildAction(b, ref, tiny, { t: 'togglePower', powerId: 'push' }).knownPowers).toEqual(['heal']); // cap 1
});

test('setName and toggleHouseRule round-trips', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setName', name: 'Kira' });
  expect(b.identity.name).toBe('Kira');
  b = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'powers' });
  b = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'powers' });
  expect(b.houseRuled).toEqual([]);
});
