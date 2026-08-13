// apps/swdnd/src/lib/shipPlayState.test.ts
import { expect, test } from 'bun:test';
import { emptyShipBuild, type DerivedShip, type ShipBuild } from './shipRules/types';
import { applyShipPlayAction, type ShipPlayAction } from './shipPlayState';

const derived = {
  maxHull: 40, maxShields: 20, shieldRegen: 8,
  hullDice: { die: 8, count: 5 }, shieldDice: { die: 8, count: 5 },
  power: {
    die: { sides: 8, label: 'd8' },
    coupling: 'hub-spoke',
    capacity: { central: 2, perSystem: 1 },
    recovery: { kind: 'power-core', formula: '1d2', label: '1d2 dice' },
  },
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

test('patchHull spends a hull die and applies its rolled result in a single dispatch', () => {
  const hurt = ship({ hull: 10 });
  expect(run(hurt, { t: 'patchHull', rolled: 6 })).toMatchObject({ hull: 16, hullDiceSpent: 1 });
  expect(run(hurt, { t: 'patchHull', rolled: 999 })).toMatchObject({ hull: 40, hullDiceSpent: 1 }); // clamped
  expect(run(ship({ hullDiceSpent: 5 }), { t: 'patchHull', rolled: 6 }).hullDiceSpent).toBe(5);      // capped
  expect(run(ship({ hull: 10 }), { t: 'patchHull', rolled: -3 }).hull).toBe(10);                     // no negative heal
});

test('regenerateShields spends a shield die and restores the fixed rate, never rolled', () => {
  const hurt = ship({ shields: 5 });
  expect(run(hurt, { t: 'regenerateShields' })).toMatchObject({ shields: 13, shieldDiceSpent: 1 }); // +shieldRegen (8)
  expect(run(ship({ shields: 15 }), { t: 'regenerateShields' }).shields).toBe(20);                  // clamped to max
  expect(run(ship({ shieldDiceSpent: 5 }), { t: 'regenerateShields' }).shieldDiceSpent).toBe(5);     // capped
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

test('power dice spend and recover within the coupling capacity', () => {
  const build = ship();                            // derived: hub & spoke — 2 central, 1 per system

  const filled = applyShipPlayAction(build, derived, { t: 'recoverPower', where: 'central', n: 5 });
  expect(filled.powerDice!.central).toBe(2);       // clamped to capacity

  const spent = applyShipPlayAction({ ...build, play: filled }, derived, { t: 'spendPower', where: 'central' });
  expect(spent.powerDice!.central).toBe(1);        // default step is one die

  const floored = applyShipPlayAction({ ...build, play: spent }, derived, { t: 'spendPower', where: 'central', n: 9 });
  expect(floored.powerDice!.central).toBe(0);
});

test('system capacitors clamp per system, independently of central', () => {
  const build = ship();
  const p1 = applyShipPlayAction(build, derived, { t: 'recoverPower', where: 'weapons', n: 3 });
  expect(p1.powerDice!.systems.weapons).toBe(1);   // hub & spoke: 1 per system
  expect(p1.powerDice!.systems.shields).toBe(0);
  expect(p1.powerDice!.central).toBe(0);

  const p2 = applyShipPlayAction({ ...build, play: p1 }, derived, { t: 'setPower', where: 'weapons', n: 0 });
  expect(p2.powerDice!.systems.weapons).toBe(0);
  const p3 = applyShipPlayAction({ ...build, play: p2 }, derived, { t: 'setPower', where: 'shields', n: 7 });
  expect(p3.powerDice!.systems.shields).toBe(1);
});

test('power actions work on a pre-v2 document with no powerDice field', () => {
  const build = ship();
  delete (build.play as { powerDice?: unknown }).powerDice;
  const p = applyShipPlayAction(build, derived, { t: 'recoverPower', where: 'engines', n: 1 });
  expect(p.powerDice).toEqual({ central: 0, systems: { comms: 0, engines: 1, shields: 0, sensors: 0, weapons: 0 } });
});

test('an explicit n: 0 moves no dice — distinct from an omitted n (default step 1)', () => {
  // Guards the ionization reactor's 1d2-1 recovery formula, which legitimately
  // rolls 0 half the time: dispatch({ t: 'recoverPower', where, n: rolled })
  // must be a no-op on a 0 roll, not silently grant a free die.
  const build = ship();
  const filled = applyShipPlayAction(build, derived, { t: 'recoverPower', where: 'central', n: 2 });

  const recoveredZero = applyShipPlayAction({ ...build, play: filled }, derived, { t: 'recoverPower', where: 'central', n: 0 });
  expect(recoveredZero.powerDice!.central).toBe(2); // unchanged, not clamped-up

  const spentZero = applyShipPlayAction({ ...build, play: filled }, derived, { t: 'spendPower', where: 'central', n: 0 });
  expect(spentZero.powerDice!.central).toBe(2);      // unchanged, not clamped-down
});
