import { describe, it, expect } from 'bun:test';
import {
  addShipCard, applyPendingShipCards, buildShipCards, cardFromShip, mergeShipCardPlay,
  type ShipCard,
} from './shipCards';
import type { StarshipDto } from './starships';
import type { ShipBuild, ShipReferenceData } from './shipRules/types';

// Partial reference literal — test files are excluded from tsconfig.app.json.
const ref = {
  sizes: { '6BN8l5E8QtYt103T': { id: '6BN8l5E8QtYt103T', name: 'Small Starship' } },
  weapons: {}, armor: {}, equipment: {}, modifications: {},
} as unknown as ShipReferenceData;

/** Overrides pin the maxima, so these assertions never depend on engine math. */
const build = (over: Partial<ShipBuild> = {}): ShipBuild => ({
  schemaVersion: 1,
  identity: { name: "Aka'jor-class Shuttle", sizeId: '6BN8l5E8QtYt103T', tier: 2 },
  abilities: { base: { str: 13, dex: 14, con: 13, int: 8, wis: 12, cha: 14 }, increases: [] },
  equipment: [],
  modifications: [],
  play: {
    hull: 20, shields: 6, hullDiceSpent: 0, shieldDiceSpent: 0,
    ammoSpent: {}, conditions: ['ionized'], systemDamage: 1, notes: '',
  },
  overrides: { maxHull: 27, maxShields: 18 },
  houseRuled: [],
  ...over,
}) as ShipBuild;

const dto = (id: string, name: string, b: ShipBuild = build()): StarshipDto => ({
  id, campaign_id: 'c1', name, data_json: b, crew: [], created_at: 'n', updated_at: 'n',
}) as StarshipDto;

const card = (over: Partial<ShipCard> = {}): ShipCard => ({
  id: 's1', name: 'Shuttle', tier: 2, sizeName: 'Small Starship',
  hull: 20, maxHull: 27, shields: 6, maxShields: 18,
  conditions: ['ionized'], systemDamage: 1, ...over,
});

describe('cardFromShip', () => {
  it('reads identity and pools, and resolves the size name from the reference', () => {
    const c = cardFromShip(dto('s1', "Aka'jor-class Shuttle"), ref);
    expect(c).toEqual({
      id: 's1', name: "Aka'jor-class Shuttle", tier: 2, sizeName: 'Small Starship',
      hull: 20, maxHull: 27, shields: 6, maxShields: 18,
      conditions: ['ionized'], systemDamage: 1,
    });
  });

  it('degrades to an empty size label for an unknown size id', () => {
    const b = build({ identity: { name: 'Nameless', sizeId: 'nope', tier: 0 } } as Partial<ShipBuild>);
    expect(cardFromShip(dto('s2', 'Nameless', b), ref).sizeName).toBe('');
  });

  it('copies conditions rather than aliasing the build', () => {
    const d = dto('s1', 'Shuttle');
    const c = cardFromShip(d, ref);
    c.conditions.push('stalled');
    expect(d.data_json.play.conditions).toEqual(['ionized']);
  });
});

describe('buildShipCards', () => {
  it('makes one card per ship', () => {
    expect(buildShipCards([dto('s1', 'A'), dto('s2', 'B')], ref).map((c) => c.id)).toEqual(['s1', 's2']);
  });
});

describe('mergeShipCardPlay', () => {
  const cards = [card({ id: 's1' }), card({ id: 's2', name: 'Other' })];

  it('overlays a live ship:updated payload', () => {
    const next = mergeShipCardPlay(cards, 's1', 'Renamed', { hull: 3, shields: 0, conditions: ['slowed-2'], systemDamage: 4 });
    expect(next[0]).toEqual(card({ id: 's1', name: 'Renamed', hull: 3, shields: 0, conditions: ['slowed-2'], systemDamage: 4 }));
    expect(next[1]).toBe(cards[1]);
  });

  it('keeps the derived maxima (a mid-session refit needs a reload, as with party cards)', () => {
    const next = mergeShipCardPlay(cards, 's1', 'X', { hull: 1, shields: 1, conditions: [], systemDamage: 0 });
    expect(next[0].maxHull).toBe(27);
    expect(next[0].maxShields).toBe(18);
  });

  it('returns the same array for an unknown id', () => {
    expect(mergeShipCardPlay(cards, 'nope', 'X', { hull: 1, shields: 1, conditions: [], systemDamage: 0 })).toBe(cards);
  });
});

describe('addShipCard', () => {
  it('appends an unknown ship and replaces a known one', () => {
    const cards = [card({ id: 's1' })];
    expect(addShipCard(cards, dto('s2', 'New'), ref).map((c) => c.id)).toEqual(['s1', 's2']);
    const replaced = addShipCard(cards, dto('s1', 'Renamed'), ref);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].name).toBe('Renamed');
  });
});

describe('applyPendingShipCards', () => {
  it('replays the shared buffered-play cache and ignores unknown ids', () => {
    const cards = [card({ id: 's1' })];
    const next = applyPendingShipCards(
      cards,
      {
        s1: { hull: 9, shields: 2, conditions: [], systemDamage: 0 },
        zz: { hull: 1, shields: 1, conditions: [], systemDamage: 0 },
      },
      { s1: 'Buffered' },
    );
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Buffered');
    expect(next[0].hull).toBe(9);
  });

  it('keeps the loaded name when no buffered name was recorded', () => {
    const cards = [card({ id: 's1', name: 'Shuttle' })];
    const next = applyPendingShipCards(cards, { s1: { hull: 1, shields: 0, conditions: [], systemDamage: 0 } });
    expect(next[0]).toEqual(card({ id: 's1', name: 'Shuttle', hull: 1, shields: 0, conditions: [], systemDamage: 0 }));
  });
});
