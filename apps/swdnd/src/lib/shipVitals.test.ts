// apps/swdnd/src/lib/shipVitals.test.ts
import { describe, expect, it } from 'bun:test';
import {
  addShipVitals, applyPendingShipPlays, buildShipVitals, crewedShipIds, mergeShipPlay,
  shipStatusNames, shipVitalsFrom, tokenShipVitals, type ShipSource, type ShipVitals,
} from './shipVitals';
import type { TokenDto } from './scenes';

const ship = (id: string, play: Record<string, unknown>): ShipSource =>
  ({ id, data_json: { play } } as unknown as ShipSource);

const maxima = () => ({ maxHull: 40, maxShields: 12 });

const token = (over: Partial<TokenDto>): TokenDto => ({
  id: 't1', scene_id: 's1', character_id: null, ship_id: null, name: 'X', color: '#fff',
  faction: 'friendly', q: 0, r: 0, scale: 1, facing: 0, hp: null, max_hp: null,
  conditions_json: [], hidden: 0, image_path: null, created_at: '', updated_at: '',
  ...over,
} as TokenDto);

describe('shipVitalsFrom', () => {
  it('reads a well-formed play document', () => {
    expect(shipVitalsFrom({ hull: 31, shields: 6, conditions: ['Ionized'], systemDamage: 2 }, { maxHull: 40, maxShields: 12 }))
      .toEqual({ hull: 31, maxHull: 40, shields: 6, maxShields: 12, conditions: ['Ionized'], systemDamage: 2 });
  });

  it('tolerates missing / junk fields on legacy documents', () => {
    expect(shipVitalsFrom(undefined, undefined))
      .toEqual({ hull: 0, maxHull: 0, shields: 0, maxShields: 0, conditions: [], systemDamage: 0 });
    expect(shipVitalsFrom({ hull: '31' as any, conditions: 'nope' as any }, { maxHull: Number.NaN } as any))
      .toEqual({ hull: 0, maxHull: 0, shields: 0, maxShields: 0, conditions: [], systemDamage: 0 });
  });

  it('clamps system damage to 0-6 and drops non-string conditions', () => {
    expect(shipVitalsFrom({ systemDamage: 99, conditions: ['Shocked', 7 as any] } as any, maxima()).systemDamage).toBe(6);
    expect(shipVitalsFrom({ systemDamage: -3 } as any, maxima()).systemDamage).toBe(0);
    expect(shipVitalsFrom({ conditions: ['Shocked', 7 as any] } as any, maxima()).conditions).toEqual(['Shocked']);
  });
});

describe('buildShipVitals / addShipVitals', () => {
  it('keys by ship id and injects the computed maxima', () => {
    const v = buildShipVitals([ship('s1', { hull: 20, shields: 4, conditions: [], systemDamage: 0 })], maxima);
    expect(v.s1).toEqual({ hull: 20, maxHull: 40, shields: 4, maxShields: 12, conditions: [], systemDamage: 0 });
  });

  it('addShipVitals folds one ship in without touching the rest', () => {
    const v = buildShipVitals([ship('s1', { hull: 20, shields: 4 })], maxima);
    const next = addShipVitals(v, ship('s2', { hull: 1, shields: 0 }), maxima);
    expect(Object.keys(next).sort()).toEqual(['s1', 's2']);
    expect(next.s1).toBe(v.s1);
  });
});

describe('mergeShipPlay', () => {
  it('updates play fields, keeps cached maxima, and is immutable', () => {
    const v: Record<string, ShipVitals> = { s1: { hull: 40, maxHull: 40, shields: 12, maxShields: 12, conditions: [], systemDamage: 0 } };
    const next = mergeShipPlay(v, 's1', { hull: 9, shields: 0, conditions: ['Stalled'], systemDamage: 3 });
    expect(next.s1).toEqual({ hull: 9, maxHull: 40, shields: 0, maxShields: 12, conditions: ['Stalled'], systemDamage: 3 });
    expect(v.s1.hull).toBe(40);
  });

  it('ignores unknown ship ids', () => {
    const v: Record<string, ShipVitals> = {};
    expect(mergeShipPlay(v, 'nope', { hull: 1 })).toBe(v);
  });
});

describe('applyPendingShipPlays', () => {
  it('overlays buffered payloads and ignores unknown ids', () => {
    const v = buildShipVitals([ship('s1', { hull: 40, shields: 12 })], maxima);
    const next = applyPendingShipPlays(v, { s1: { hull: 5, shields: 0, conditions: ['Ionized'], systemDamage: 1 }, ghost: { hull: 0, shields: 0, conditions: [], systemDamage: 0 } });
    expect(next.s1.hull).toBe(5);
    expect(next.s1.maxHull).toBe(40);
    expect(next.ghost).toBeUndefined();
  });

  it('empty pending is identity', () => {
    const v = buildShipVitals([ship('s1', { hull: 40 })], maxima);
    expect(applyPendingShipPlays(v, {})).toBe(v);
  });
});

describe('tokenShipVitals', () => {
  it('returns null for non-ship tokens and for unloaded ships', () => {
    expect(tokenShipVitals(token({}), {})).toBeNull();
    expect(tokenShipVitals(token({ ship_id: 's-unloaded' }), {})).toBeNull();
  });

  it('resolves a ship token to its ship vitals', () => {
    const v = buildShipVitals([ship('s1', { hull: 12, shields: 3 })], maxima);
    expect(tokenShipVitals(token({ ship_id: 's1' }), v)?.hull).toBe(12);
  });
});

describe('crewedShipIds', () => {
  it('selects ships crewed by any owned character', () => {
    const ships = [
      { id: 's1', crew: [{ character_id: 'c1' }, { character_id: 'c9' }] },
      { id: 's2', crew: [{ character_id: 'c9' }] },
      { id: 's3' },
    ];
    const got = crewedShipIds(ships, new Set(['c1']));
    expect([...got]).toEqual(['s1']);
  });

  it('empty ownership selects nothing', () => {
    expect(crewedShipIds([{ id: 's1', crew: [{ character_id: 'c1' }] }], new Set()).size).toBe(0);
  });
});

describe('shipStatusNames', () => {
  it('appends a system-damage chip only when damaged', () => {
    const base = shipVitalsFrom({ conditions: ['Ionized'], systemDamage: 0 } as any, maxima());
    expect(shipStatusNames(base)).toEqual(['Ionized']);
    expect(shipStatusNames({ ...base, systemDamage: 4 })).toEqual(['Ionized', 'sys 4']);
  });
});
