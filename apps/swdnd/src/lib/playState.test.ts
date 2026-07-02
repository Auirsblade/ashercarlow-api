// apps/swdnd/src/lib/playState.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type DerivedSheet, type RefPower } from './rules/types';
import { applyPlayAction } from './playState';

function derived(over: Partial<DerivedSheet> = {}): DerivedSheet {
  return {
    totalLevel: 5, proficiencyBonus: 3,
    abilities: {} as DerivedSheet['abilities'],
    maxHp: 30, armorClass: 12, initiative: 2, speed: 30,
    hitDice: { d6: 5 },
    savingThrows: {} as DerivedSheet['savingThrows'],
    skills: [],
    casting: {
      force: { classes: 1, casterLevel: 5, maxPowerLevel: 3, pointsMax: 22, knownMax: 17, ability: 'wis', saveDc: 14, attackBonus: 6 },
      tech: { classes: 0, casterLevel: 0, maxPowerLevel: 0, pointsMax: 0, knownMax: 0, ability: null, saveDc: null, attackBonus: null },
    },
    superiority: null,
    ...over,
  };
}
function build(play: Partial<import('./rules/types').PlayState> = {}) {
  const b = emptyBuild('x');
  b.play = { ...b.play, hp: 20, tempHp: 0, ...play };
  return b;
}

test('damage eats temp HP first then HP, floored at 0', () => {
  const p = applyPlayAction(build({ hp: 20, tempHp: 5 }), derived(), { t: 'damage', n: 8 });
  expect(p.tempHp).toBe(0);
  expect(p.hp).toBe(17);
  expect(applyPlayAction(build({ hp: 3 }), derived(), { t: 'damage', n: 10 }).hp).toBe(0);
});

test('heal caps at derived maxHp', () => {
  expect(applyPlayAction(build({ hp: 28 }), derived(), { t: 'heal', n: 10 }).hp).toBe(30);
});

test('spendForce and castPower clamp to the pool and use power cost level+1', () => {
  const b = build();
  expect(applyPlayAction(b, derived(), { t: 'spendForce', n: 5 }).forcePointsSpent).toBe(5);
  const power: RefPower = { id: 'heal', name: 'Heal', level: 1, castType: 'force' };
  expect(applyPlayAction(b, derived(), { t: 'castPower', power }).forcePointsSpent).toBe(2); // 1+1
  const spent = { ...b, play: { ...b.play, forcePointsSpent: 21 } };
  expect(applyPlayAction(spent, derived(), { t: 'castPower', power }).forcePointsSpent).toBe(22); // clamp at max 22
});

test('at-will power (level 0) costs 0', () => {
  const power: RefPower = { id: 'push', name: 'Push', level: 0, castType: 'force' };
  expect(applyPlayAction(build(), derived(), { t: 'castPower', power }).forcePointsSpent).toBe(0);
});

test('hit dice, conditions, exhaustion, inspiration', () => {
  const b = build();
  expect(applyPlayAction(b, derived(), { t: 'spendHitDie' }).hitDiceSpent).toBe(1);
  const c1 = applyPlayAction(b, derived(), { t: 'addCondition', c: 'Prone' });
  expect(c1.conditions).toEqual(['Prone']);
  const cDup = applyPlayAction({ ...b, play: c1 }, derived(), { t: 'addCondition', c: 'Prone' });
  expect(cDup.conditions).toEqual(['Prone']); // no duplicate
  expect(applyPlayAction({ ...b, play: c1 }, derived(), { t: 'removeCondition', c: 'Prone' }).conditions).toEqual([]);
  expect(applyPlayAction(b, derived(), { t: 'setExhaustion', n: 9 }).exhaustion).toBe(6); // clamp 0..6
  expect(applyPlayAction(b, derived(), { t: 'toggleInspiration' }).inspiration).toBe(true);
});

test('spendSuperiority clamps to derived diceMax (0 when no superiority)', () => {
  expect(applyPlayAction(build(), derived(), { t: 'spendSuperiority' }).superiorityDiceSpent).toBe(0);
  const withSup = derived({ superiority: { level: 3, diceMax: 4, die: 'd8', knownMax: 4 } });
  expect(applyPlayAction(build(), withSup, { t: 'spendSuperiority' }).superiorityDiceSpent).toBe(1);
});
