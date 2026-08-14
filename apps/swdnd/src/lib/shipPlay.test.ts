// apps/swdnd/src/lib/shipPlay.test.ts
import { describe, expect, it } from 'bun:test';
import { setSystemDamage, toggleShipCondition } from './shipPlay';

const doc = (play: Record<string, unknown>) =>
  ({ schemaVersion: 1, identity: { name: 'Krayt' }, play } as any);

describe('toggleShipCondition', () => {
  it('adds, then removes, leaving the rest of the document intact', () => {
    const a = toggleShipCondition(doc({ hull: 20, conditions: [], systemDamage: 0 }), 'Ionized');
    expect(a.play.conditions).toEqual(['Ionized']);
    expect(a.play.hull).toBe(20);
    expect(a.identity.name).toBe('Krayt');
    const b = toggleShipCondition(a, 'Ionized');
    expect(b.play.conditions).toEqual([]);
  });

  it('is immutable and tolerates a missing conditions array', () => {
    const before = doc({ hull: 20 });
    const after = toggleShipCondition(before, 'Stalled');
    expect(after.play.conditions).toEqual(['Stalled']);
    expect(before.play.conditions).toBeUndefined();
  });

  it('leaves unrelated conditions alone', () => {
    const d = toggleShipCondition(doc({ conditions: ['Tractored', 'Slowed 2'] }), 'Slowed 2');
    expect(d.play.conditions).toEqual(['Tractored']);
  });

  it('a levelled condition replaces its own family, as addCondition does on the sheet', () => {
    const d = toggleShipCondition(doc({ conditions: ['Tractored', 'Slowed 1'] }), 'Slowed 3');
    expect(d.play.conditions).toEqual(['Tractored', 'Slowed 3']);
    // …and stepping down a level is the same single-entry replacement.
    expect(toggleShipCondition(d, 'Slowed 2').play.conditions).toEqual(['Tractored', 'Slowed 2']);
  });

  it('picking the active level again clears the family', () => {
    expect(toggleShipCondition(doc({ conditions: ['Slowed 3'] }), 'Slowed 3').play.conditions).toEqual([]);
  });
});

describe('setSystemDamage', () => {
  it('clamps to 0-6 and keeps conditions untouched', () => {
    expect(setSystemDamage(doc({ conditions: ['Shocked'], systemDamage: 0 }), 3).play.systemDamage).toBe(3);
    expect(setSystemDamage(doc({ systemDamage: 0 }), 99).play.systemDamage).toBe(6);
    expect(setSystemDamage(doc({ systemDamage: 4 }), -2).play.systemDamage).toBe(0);
    expect(setSystemDamage(doc({ conditions: ['Shocked'] }), 2).play.conditions).toEqual(['Shocked']);
  });

  it('rounds junk input to a valid counter', () => {
    expect(setSystemDamage(doc({}), 2.6 as number).play.systemDamage).toBe(3);
    expect(setSystemDamage(doc({}), Number.NaN).play.systemDamage).toBe(0);
  });
});
