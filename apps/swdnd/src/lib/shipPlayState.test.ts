// apps/swdnd/src/lib/shipPlayState.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type DerivedShip, type ShipBuild } from './shipRules/types';
import { applyShipPlayAction, type ShipPlayAction } from './shipPlayState';

const derived = {
  maxHull: 40, maxShields: 20, shieldRegen: 8,
  hullDice: { die: 8, count: 5 }, shieldDice: { die: 8, count: 5 },
} as unknown as DerivedShip;

function ship(over: Partial<ShipBuild['play']> = {}): ShipBuild {
  const b = emptyShipBuild('Ghost');
  b.play = { ...b.play, hull: 40, shields: 20, ...over };
  return b;
}
const run = (b: ShipBuild, ...actions: ShipPlayAction[]) =>
  actions.reduce((acc, a) => ({ ...b, play: applyShipPlayAction({ ...b, play: acc }, derived, a) }).play, b.play);

test('damage spills through shields into hull and never goes negative', () => {
  expect(run(ship(), { t: 'damage', n: 5 })).toMatchObject({ shields: 15, hull: 40 });
  expect(run(ship(), { t: 'damage', n: 25 })).toMatchObject({ shields: 0, hull: 35 });
  expect(run(ship(), { t: 'damage', n: 500 })).toMatchObject({ shields: 0, hull: 0 });
  expect(run(ship(), { t: 'damage', n: -3 })).toMatchObject({ shields: 20, hull: 40 });
});

test('repairs and restores clamp to their maxima', () => {
  const hurt = ship({ hull: 10, shields: 2 });
  expect(run(hurt, { t: 'repairHull', n: 7 }).hull).toBe(17);
  expect(run(hurt, { t: 'repairHull', n: 999 }).hull).toBe(40);
  expect(run(hurt, { t: 'restoreShields', n: 999 }).shields).toBe(20);
  expect(run(hurt, { t: 'restoreShields', n: -5 }).shields).toBe(2);
});

test('exact-entry setters clamp into range', () => {
  expect(run(ship(), { t: 'setHull', n: 17 }).hull).toBe(17);
  expect(run(ship(), { t: 'setHull', n: -4 }).hull).toBe(0);
  expect(run(ship(), { t: 'setHull', n: 900 }).hull).toBe(40);
  expect(run(ship(), { t: 'setShields', n: 900 }).shields).toBe(20);
});

test('hull and shield dice spend and regain within their pools', () => {
  const p = run(ship(), { t: 'spendHullDie' }, { t: 'spendHullDie' }, { t: 'spendShieldDie' });
  expect(p).toMatchObject({ hullDiceSpent: 2, shieldDiceSpent: 1 });
  expect(run(ship({ hullDiceSpent: 5 }), { t: 'spendHullDie' }).hullDiceSpent).toBe(5);   // capped
  expect(run(ship({ hullDiceSpent: 0 }), { t: 'regainHullDie' }).hullDiceSpent).toBe(0);  // floored
  expect(run(ship({ shieldDiceSpent: 3 }), { t: 'regainShieldDie' }).shieldDiceSpent).toBe(2);
});

test('ammo counters key off the equipment entry id and reload clears them', () => {
  const p = run(ship(), { t: 'spendAmmo', entryId: 'w1', n: 2 }, { t: 'spendAmmo', entryId: 'w1', n: 1 });
  expect(p.ammoSpent).toEqual({ w1: 3 });
  expect(run(ship({ ammoSpent: { w1: 4, w2: 1 } }), { t: 'reloadAmmo', entryId: 'w1' }).ammoSpent).toEqual({ w2: 1 });
  expect(run(ship({ ammoSpent: { w1: 1 } }), { t: 'spendAmmo', entryId: 'w1', n: -9 }).ammoSpent).toEqual({ w1: 0 });
});

test('conditions add once and remove cleanly; levelled conditions replace their own family', () => {
  const p = run(ship(), { t: 'addCondition', c: 'Ionized' }, { t: 'addCondition', c: 'Ionized' });
  expect(p.conditions).toEqual(['Ionized']);
  expect(run(ship({ conditions: ['Ionized', 'Stalled'] }), { t: 'removeCondition', c: 'Ionized' }).conditions)
    .toEqual(['Stalled']);
  // A ship is Slowed at exactly one level at a time.
  expect(run(ship({ conditions: ['Slowed 1'] }), { t: 'addCondition', c: 'Slowed 3' }).conditions)
    .toEqual(['Slowed 3']);
});

test('system damage is its own 0..6 field, not a condition string', () => {
  expect(run(ship(), { t: 'setSystemDamage', n: 3 }).systemDamage).toBe(3);
  expect(run(ship(), { t: 'setSystemDamage', n: 9 }).systemDamage).toBe(6);
  expect(run(ship(), { t: 'setSystemDamage', n: -2 }).systemDamage).toBe(0);
  expect(run(ship(), { t: 'setSystemDamage', n: 3 }).conditions).toEqual([]);
});

test('notes are stored verbatim and the reducer never mutates its input', () => {
  const b = ship();
  const next = applyShipPlayAction(b, derived, { t: 'setNotes', notes: 'venting plasma' });
  expect(next.notes).toBe('venting plasma');
  expect(b.play.notes).toBe('');
  expect(next.conditions).not.toBe(b.play.conditions);
});
