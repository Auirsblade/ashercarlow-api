// apps/swdnd/src/lib/progression.integration.test.ts
// Spec §8: (a) Consular 1→5 with archetype+ASI, (b) multiclass gate + derived,
// (c) remove-last-level round-trip.
import { test, expect } from 'bun:test';
import { emptyBuild, type CharacterBuild, type ReferenceData, type RefClass } from './rules/types';
import { computeSheet } from './rules';
import { applyBuildAction, type BuildAction } from './buildState';
import { stepStatus } from './validation';

const consular: RefClass = {
  id: 'consular', name: 'Consular', identifier: 'consular', hitDie: 6, saves: ['wis', 'cha'],
  skillChoices: ['ins', 'lor'], skillNumber: 2, asiLevels: [4, 8, 12, 16, 19],
  powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0, description: '',
};
const fighter: RefClass = {
  id: 'fighter', name: 'Fighter', identifier: 'fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: ['ath'], skillNumber: 2, asiLevels: [4, 6, 8, 12, 14, 16, 19],
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 1, description: '',
};
const sage = {
  id: 'sage', name: 'Sage', classIdentifier: 'consular',
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0, description: '',
};
const ref = {
  classes: { consular, fighter }, archetypes: { sage },
  species: {}, armor: {}, weapons: {}, powers: {}, backgrounds: {}, feats: {}, maneuvers: {}, gear: {},
} as unknown as ReferenceData;

/** Mirror useBuilder: recompute derived before every action. */
const step = (b: CharacterBuild, action: BuildAction) =>
  applyBuildAction(b, ref, computeSheet(b, ref), action);

test('(a) Consular 1→5: hp fills and tracks, archetype at 3, ASI at 4, engine numbers', () => {
  let b = emptyBuild('Lyra');
  b.identity.alignment = 'light';
  b.abilities.base.wis = 15; // → 17 after the ASI
  b.abilities.base.con = 12; // +1 per level

  b = step(b, { t: 'addLevel', classId: 'consular' });
  expect(computeSheet(b, ref).maxHp).toBe(7); // die 6 + con 1
  expect(b.play.hp).toBe(7);                  // first pick fills to max
  expect(b.proficiencies.savingThrows).toEqual(['wis', 'cha']);

  for (let i = 0; i < 4; i++) b = step(b, { t: 'addLevel', classId: 'consular' });
  expect(computeSheet(b, ref).maxHp).toBe(27); // 7 + 4×(4+1)
  expect(b.play.hp).toBe(27);

  expect(stepStatus(b, ref, computeSheet(b, ref)).class.state).toBe('attention'); // archetype + ASI pending
  b = step(b, { t: 'setArchetype', classId: 'consular', archetypeId: 'sage' });
  expect(b.levels[2].archetypeId).toBe('sage');

  b = step(b, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  b = step(b, { t: 'allocateAsiPoint', n: 4, ability: 'wis', delta: 1 });
  b = step(b, { t: 'allocateAsiPoint', n: 4, ability: 'wis', delta: 1 });

  const d = computeSheet(b, ref);
  expect(d.abilities.wis.score).toBe(17);
  expect(b.play.hp).toBe(27);                // WIS ASI never moves current hp
  expect(d.casting.force.casterLevel).toBe(5);
  expect(d.casting.force.maxPowerLevel).toBe(3);
  expect(d.casting.force.knownMax).toBe(17);
  expect(d.casting.force.saveDc).toBe(8 + 3 + 3); // prof 3 + wis 3
  const s = stepStatus(b, ref, d);
  expect(s.class.state).toBe('done');
  expect(s.class.summary).toBe('Consular 5');
});

test('(b) Consular 4 / Fighter 1: prereq path, then derived matches Phase 1 casting', () => {
  let b = emptyBuild('Brakk');
  b.identity.alignment = 'light';
  b.abilities.base.str = 13;
  b.abilities.base.wis = 12;
  b = step(b, { t: 'addLevel', classId: 'fighter' });
  // wis 12 blocks the consular dip
  expect(step(b, { t: 'addLevel', classId: 'consular' }).levels).toHaveLength(1);
  // ...and str 12 on the EXISTING side blocks too
  let c = emptyBuild('y');
  c.abilities.base.str = 12; c.abilities.base.wis = 18;
  c = step(c, { t: 'addLevel', classId: 'fighter' });
  expect(step(c, { t: 'addLevel', classId: 'consular' }).levels).toHaveLength(1);
  // house rule bypasses
  const hr = step(step(b, { t: 'toggleHouseRule', step: 'class' }), { t: 'addLevel', classId: 'consular' });
  expect(hr.levels).toHaveLength(2);
  // legit path: wis 14 → build Fighter 1 / Consular 4
  b = step(b, { t: 'setBaseAbilities', base: { ...b.abilities.base, wis: 14 } });
  for (let i = 0; i < 4; i++) b = step(b, { t: 'addLevel', classId: 'consular' });
  const d = computeSheet(b, ref);
  expect(d.totalLevel).toBe(5);
  // multiclass caster level: consular full weight 1 × 4 levels → full[4] = power level 2
  expect(d.casting.force.casterLevel).toBe(4);
  expect(d.casting.force.maxPowerLevel).toBe(2);
  expect(d.superiority?.die).toBe('d4'); // fighter 1
  // consular's 4th class level (entry n=5) is an ASI level → election pending first
  expect(stepStatus(b, ref, d).class.summary).toBe('L5 ASI/feat pending');
  b = step(b, { t: 'setAsiChoice', n: 5, choice: 'feat' });
  b = step(b, { t: 'setArchetype', classId: 'consular', archetypeId: 'sage' });
  expect(stepStatus(b, ref, computeSheet(b, ref)).class.summary).toBe('Fighter 1 / Consular 4');
});

test('(c) removeLastLevel round-trips an add + ASI decisions exactly', () => {
  let b = emptyBuild('rt');
  b.abilities.base.con = 14;
  for (let i = 0; i < 3; i++) b = step(b, { t: 'addLevel', classId: 'fighter' });
  const before = JSON.parse(JSON.stringify(b));

  let c = step(b, { t: 'addLevel', classId: 'fighter' }); // L4 = fighter ASI level
  c = step(c, { t: 'setAsiChoice', n: 4, choice: 'asi' });
  c = step(c, { t: 'allocateAsiPoint', n: 4, ability: 'con', delta: 1 });
  c = step(c, { t: 'allocateAsiPoint', n: 4, ability: 'con', delta: 1 }); // con 16 — max moves, hp doesn't
  expect(c.play.hp).toBe(before.play.hp + 8); // the level's own avg(6)+con(2)

  c = step(c, { t: 'removeLastLevel' });
  expect(JSON.parse(JSON.stringify(c))).toEqual(before);
});
