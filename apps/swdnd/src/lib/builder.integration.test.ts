// apps/swdnd/src/lib/builder.integration.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type ReferenceData, type RefClass, type RefSpecies } from './rules/types';
import { computeSheet } from './rules';
import { applyBuildAction, type BuildAction } from './buildState';
import { stepStatus, STEP_ORDER } from './validation';

const consular: RefClass = {
  id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor', 'per'], skillNumber: 2,
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: ['ath', 'prc'], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0.5, description: '',
};
const human: RefSpecies = { id: 'human', name: 'Human', walkSpeed: 30, description: '', abilityIncreases: { fixed: {}, points: 4 } };
const powers = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`p${i}`, { id: `p${i}`, name: `Power ${i}`, level: i === 0 ? 0 : 1, castType: 'force' as const, description: '' }]),
);
const ref = {
  classes: { consular, fighter }, species: { human }, archetypes: {},
  armor: { suit: { id: 'suit', name: 'Combat suit', baseAc: 11, dexCap: null, kind: 'light', price: 200, description: '' } },
  weapons: {}, powers,
  backgrounds: { jedi: { id: 'jedi', name: 'Jedi', description: '', featureName: 'Faithful', skillProse: null, toolProse: null, equipmentProse: null } },
  feats: {}, maneuvers: { m1: { id: 'm1', name: 'Feint', maneuverType: 'physical', description: '' } }, gear: {},
} as unknown as ReferenceData;

function drive(build = emptyBuild('Test'), actions: BuildAction[]) {
  return actions.reduce((b, a) => applyBuildAction(b, ref, computeSheet(b, ref), a), build);
}

test('a full Consular level-1 build reaches all-done and computes correctly', () => {
  const b = drive(emptyBuild('Lyra'), [
    { t: 'setSpecies', speciesId: 'human' },
    { t: 'allocateSpeciesPoint', ability: 'wis', delta: 1 },
    { t: 'allocateSpeciesPoint', ability: 'wis', delta: 1 },
    { t: 'allocateSpeciesPoint', ability: 'dex', delta: 1 },
    { t: 'allocateSpeciesPoint', ability: 'con', delta: 1 },
    { t: 'setBackground', backgroundId: 'jedi' },
    { t: 'setClass', classId: 'consular' },
    { t: 'setBaseAbilities', base: { str: 10, dex: 13, con: 11, int: 13, wis: 15, cha: 11 } },
    { t: 'toggleSkill', skill: 'ins' },
    { t: 'toggleSkill', skill: 'lor' },
    { t: 'addEquipment', ref: 'suit' },
    ...Array.from({ length: 9 }, (_, i) => ({ t: 'togglePower' as const, powerId: `p${i}` })),
  ]);
  const derived = computeSheet(b, ref);
  const status = stepStatus(b, ref, derived);
  for (const k of STEP_ORDER) {
    if (k === 'deployments') continue; // opt-in crew content — untouched is a valid resting state, not "incomplete"
    if (status[k].applicable) expect(`${k}:${status[k].state}`).toBe(`${k}:done`);
  }
  expect(status.deployments.state).toBe('untouched');
  // wis 15 + 2 species = 17 (+3); consular L1: hp 6+conMod(1)=7, force pool 4+3=7, known 9 = POWERS_KNOWN.force.full[1]
  expect(derived.abilities.wis).toEqual({ score: 17, mod: 3 });
  expect(derived.maxHp).toBe(7);
  expect(derived.casting.force.knownMax).toBe(9);
  expect(derived.casting.force.pointsMax).toBe(7);
  expect(derived.armorClass).toBe(11 + 2); // suit + dex 14 -> mod 2
  expect(b.knownPowers).toHaveLength(9);
});

test('a Fighter level-1 build exposes maneuvers and completes via them', () => {
  const b = drive(emptyBuild('Brakk'), [
    { t: 'setClass', classId: 'fighter' },
    { t: 'toggleManeuver', maneuverId: 'm1' },
  ]);
  const derived = computeSheet(b, ref);
  expect(derived.superiority).toEqual({ level: 1, diceMax: 2, die: 'd4', knownMax: 1 });
  const status = stepStatus(b, ref, derived);
  expect(status.powers.applicable).toBe(true);
  expect(status.powers.state).toBe('done');
});
