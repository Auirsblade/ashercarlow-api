// apps/swdnd/src/lib/buildState.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type DerivedSheet, type ReferenceData, type RefClass, type RefSpecies } from './rules/types';
import { applyBuildAction } from './buildState';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  identifier: 'consular', asiLevels: [4, 8, 12, 16, 19],
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', identifier: 'fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: [], skillNumber: 2, asiLevels: [4, 6, 8, 12, 14, 16, 19],
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 1, description: '',
};
const zabrak: RefSpecies = {
  id: 'zabrak', name: 'Zabrak', walkSpeed: 30, description: '',
  abilityIncreases: { fixed: { con: 2 }, points: 1 },
};
const human: RefSpecies = {
  id: 'human', name: 'Human', walkSpeed: 30, description: '',
  abilityIncreases: { fixed: {}, points: 4 },
};
const sage = {
  id: 'sage', name: 'Sage', classIdentifier: 'consular',
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0, description: '',
};
const tactician = {
  id: 'tactician', name: 'Tactician', classIdentifier: 'fighter',
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0, description: '',
};
const ref = {
  classes: { consular, fighter }, species: { zabrak, human },
  archetypes: { sage, tactician }, armor: {}, weapons: {},
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
  b = applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 1, featId: 'f1' });
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

test('addLevel on an empty build sets saves and fills hp to the new max', () => {
  const b = emptyBuild('x');
  b.abilities.base.con = 12; // +1
  const r = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  expect(r.levels).toEqual([{ n: 1, classId: 'fighter', archetypeId: null, hp: 'avg', choices: {} }]);
  expect(r.proficiencies.savingThrows).toEqual(['str', 'con']);
  expect(r.play.hp).toBe(11); // die 10 + con 1
});

test('addLevel appends and bumps current hp by the delta; unknown class is a no-op', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  expect(b.levels.map((l) => l.n)).toEqual([1, 2]);
  expect(b.play.hp).toBe(16); // 10 + avg 6
  expect(applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'nope' }).levels).toHaveLength(2);
});

test('addLevel enforces the multiclass gate unless house-ruled', () => {
  let b = emptyBuild('x');
  b.abilities.base.str = 13; b.abilities.base.wis = 12;
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  expect(applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'consular' }).levels).toHaveLength(1);
  const unlocked = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'class' });
  expect(applyBuildAction(unlocked, ref, derived, { t: 'addLevel', classId: 'consular' }).levels).toHaveLength(2);
});

test('addLevel caps at 20 levels', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  for (let i = 0; i < 25; i++) b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  expect(b.levels).toHaveLength(20);
});

test('removeLastLevel pops the entry, resets saves when empty, and lowers hp', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'removeLastLevel' });
  expect(b.levels).toHaveLength(1);
  expect(b.play.hp).toBe(10);
  b = applyBuildAction(b, ref, derived, { t: 'removeLastLevel' });
  expect(b.levels).toEqual([]);
  expect(b.proficiencies.savingThrows).toEqual([]);
  expect(b.play.hp).toBe(0);
  expect(applyBuildAction(b, ref, derived, { t: 'removeLastLevel' }).levels).toEqual([]); // no-op on empty
});

test('setLevelHp clamps the roll to 1..die, moves hp by the delta, ignores level 1', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  // L2 avg 6 → roll 10: +4
  b = applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 2, hp: 10 });
  expect(b.levels[1].hp).toBe(10);
  expect(b.play.hp).toBe(20);
  b = applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 2, hp: 99 });
  expect(b.levels[1].hp).toBe(10); // clamped to the die
  b = applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 2, hp: 'avg' });
  expect(b.play.hp).toBe(16);
  const untouched = applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 1, hp: 3 });
  expect(untouched.levels[0].hp).toBe('avg'); // level 1 is always max die
});

test('hp delta clamps to 0..newMax (damaged character keeps damage)', () => {
  let b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'addLevel', classId: 'fighter' });
  b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  b.play.hp = 2; // took damage
  b = applyBuildAction(b, ref, derived, { t: 'removeLastLevel' });
  expect(b.play.hp).toBe(0); // 2 - 6 clamps at 0
});

test('setClass also fills hp to max on a fresh build', () => {
  const b = applyBuildAction(emptyBuild('x'), ref, derived, { t: 'setClass', classId: 'consular' });
  expect(b.play.hp).toBe(6);
});

const fighterAt = (levels: number, base: Partial<Record<'str' | 'con', number>> = {}) => {
  let b = emptyBuild('x');
  Object.assign(b.abilities.base, base);
  for (let i = 0; i < levels; i++) b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: 'fighter' });
  return b;
};

test('setAsiChoice stores the election; switching clears the other grant', () => {
  let b = fighterAt(4);
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  expect(b.levels[3].choices).toEqual({ asiOrFeat: 'asi' });
  b = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 });
  expect(b.abilities.increases).toContainEqual({ source: 'asi', ref: 'l4', ability: 'str', amount: 1 });
  // switch to feat → ASI increases for l4 are wiped
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'feat' });
  expect(b.abilities.increases.filter((i) => i.ref === 'l4')).toEqual([]);
  b = applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 4, featId: 'f1' });
  expect(b.levels[3].choices).toEqual({ asiOrFeat: 'feat', featId: 'f1' });
  // switch back to asi → feat slot is wiped
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  expect(b.levels[3].choices).toEqual({ asiOrFeat: 'asi' });
  // clear election entirely
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: null });
  expect(b.levels[3].choices).toEqual({});
});

test('allocateAsiPoint: budget of 2, cap 20, requires an asi election, removable', () => {
  let b = fighterAt(4, { str: 18 });
  expect(applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 })
    .abilities.increases).toEqual([]); // no election yet
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  b = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 });
  b = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 }); // str 20
  const capped = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'con', delta: 1 });
  expect(capped.abilities.increases.filter((i) => i.ref === 'l4')).toHaveLength(2); // budget spent
  const over = applyBuildAction(
    applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: -1 }),
    ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 },
  );
  expect(over.abilities.increases.filter((i) => i.ref === 'l4' && i.ability === 'str')).toHaveLength(2);
  // at str 20, another str point is refused even with budget
  let atCap = fighterAt(4, { str: 20 });
  atCap = applyBuildAction(atCap, ref, derived, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  atCap = applyBuildAction(atCap, ref, derived, { t: 'allocateAsiPoint', n: 4, ability: 'str', delta: 1 });
  expect(atCap.abilities.increases).toEqual([]);
});

test('setFeatForLevel: L1 is always allowed, other levels need a feat election', () => {
  let b = fighterAt(2);
  b = applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 1, featId: 'f1' });
  expect(b.levels[0].choices).toEqual({ featId: 'f1' });
  b = applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 1, featId: null });
  expect(b.levels[0].choices).toEqual({});
  expect(applyBuildAction(b, ref, derived, { t: 'setFeatForLevel', n: 2, featId: 'f1' })
    .levels[1].choices).toEqual({}); // L2 has no feat election
});

test('setArchetype stores on the class 3rd-level entry, gated by classIdentifier', () => {
  let b = fighterAt(3);
  // wrong-class archetype refused while locked
  expect(applyBuildAction(b, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'sage' })
    .levels[2].archetypeId).toBeNull();
  b = applyBuildAction(b, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'tactician' });
  expect(b.levels.map((l) => l.archetypeId)).toEqual([null, null, 'tactician']);
  // house rule opens cross-class archetypes
  let hr = applyBuildAction(b, ref, derived, { t: 'toggleHouseRule', step: 'class' });
  hr = applyBuildAction(hr, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'sage' });
  expect(hr.levels[2].archetypeId).toBe('sage');
  // clearing
  b = applyBuildAction(b, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: null });
  expect(b.levels[2].archetypeId).toBeNull();
  // under 3 class levels → no-op
  const low = fighterAt(2);
  expect(applyBuildAction(low, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'tactician' })
    .levels.every((l) => l.archetypeId === null)).toBe(true);
});

test('ASI actions refuse non-ASI levels', () => {
  let b = fighterAt(5);
  b = applyBuildAction(b, ref, derived, { t: 'setAsiChoice', n: 5, choice: 'asi' });
  expect(b.levels[4].choices).toEqual({}); // fighter level 5 grants no ASI
  b = applyBuildAction(b, ref, derived, { t: 'allocateAsiPoint', n: 5, ability: 'str', delta: 1 });
  expect(b.abilities.increases).toEqual([]);
});

test('setArchetype targets the class 3rd entry under interleaved multiclassing', () => {
  let b = emptyBuild('x');
  b.abilities.base.str = 13; b.abilities.base.wis = 13;
  for (const cid of ['fighter', 'consular', 'fighter', 'fighter']) {
    b = applyBuildAction(b, ref, derived, { t: 'addLevel', classId: cid });
  }
  b = applyBuildAction(b, ref, derived, { t: 'setArchetype', classId: 'fighter', archetypeId: 'tactician' });
  expect(b.levels.map((l) => l.archetypeId)).toEqual([null, null, null, 'tactician']); // fighter's 3rd entry is n=4
});

test('setLevelHp on a non-existent level is a no-op', () => {
  const b = fighterAt(2);
  expect(applyBuildAction(b, ref, derived, { t: 'setLevelHp', n: 9, hp: 5 })).toEqual(b);
});
