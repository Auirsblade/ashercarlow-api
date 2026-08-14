// apps/swdnd/src/lib/spawn.test.ts
import { describe, expect, it } from 'bun:test';
import { hexDistance } from './hex';
import { copyName, shipSpawnBody, spawnBodies, spawnPositions } from './spawn';
import type { MonsterView } from './monsters';

const view = (over: Partial<MonsterView> = {}): MonsterView => ({
  id: 'm1', name: 'Probe Droid', cr: 0.25, crLabel: '1/4', type: 'droid', size: 'Small',
  hp: 25, hpFormula: null, ac: 12, speed: '30 ft.',
  abilities: { str: 10, dex: 12, con: 10, int: 14, wis: 10, cha: 10 },
  traits: [], actions: [], powers: [], ...over,
});

describe('spawnPositions', () => {
  it('returns exactly count hexes, center first, sorted center-out, all unique', () => {
    const center = { q: 3, r: -1 };
    const pos = spawnPositions(center, 9);
    expect(pos).toHaveLength(9);
    expect(pos[0]).toEqual(center);
    const dists = pos.map((h) => hexDistance(center, h));
    expect(dists).toEqual([...dists].sort((a, b) => a - b)); // non-decreasing
    expect(new Set(pos.map((h) => `${h.q},${h.r}`)).size).toBe(9);
    expect(Math.max(...dists)).toBe(2); // 9 fit in radius 2 (1+6+2)
  });

  it('count 1 is just the center; count 0 is empty', () => {
    expect(spawnPositions({ q: 0, r: 0 }, 1)).toEqual([{ q: 0, r: 0 }]);
    expect(spawnPositions({ q: 0, r: 0 }, 0)).toEqual([]);
  });
});

describe('spawnBodies', () => {
  it('builds hostile token payloads with hp prefilled and #N suffixes for multiples', () => {
    const bodies = spawnBodies(view(), 3, spawnPositions({ q: 0, r: 0 }, 3));
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toEqual({ name: 'Probe Droid', faction: 'hostile', q: 0, r: 0, hp: 25, max_hp: 25 });
    expect(bodies[1].name).toBe('Probe Droid #2');
    expect(bodies[2].name).toBe('Probe Droid #3');
    expect(bodies[1].q === 0 && bodies[1].r === 0).toBe(false); // distinct hexes
  });

  it('single spawn gets no suffix; null hp passes through as null', () => {
    const bodies = spawnBodies(view({ hp: null }), 1, spawnPositions({ q: 2, r: 2 }, 1));
    expect(bodies).toEqual([{ name: 'Probe Droid', faction: 'hostile', q: 2, r: 2, hp: null, max_hp: null }]);
  });
});

describe('copyName', () => {
  it('suffixes copies after the first', () => {
    expect(copyName('ARC-170 Starfighter', 0)).toBe('ARC-170 Starfighter');
    expect(copyName('ARC-170 Starfighter', 1)).toBe('ARC-170 Starfighter #2');
    expect(copyName('ARC-170 Starfighter', 2)).toBe('ARC-170 Starfighter #3');
  });
});

describe('shipSpawnBody', () => {
  it('binds the token to its starship row, hostile, facing forward, one hex across', () => {
    expect(shipSpawnBody('ship-1', 'ARC-170 Starfighter', 27, 27, { q: 3, r: -1 })).toEqual({
      name: 'ARC-170 Starfighter',
      faction: 'hostile',
      q: 3,
      r: -1,
      hp: 27,
      max_hp: 27,
      ship_id: 'ship-1',
      facing: 0,
      scale: 1,
    });
  });

  it('accepts an explicit facing and footprint span', () => {
    expect(shipSpawnBody('ship-1', 'X', 10, 20, { q: 0, r: 0 }, 3).facing).toBe(3);
    expect(shipSpawnBody('ship-1', 'X', 10, 20, { q: 0, r: 0 }, 0, 4).scale).toBe(4);
  });
});
