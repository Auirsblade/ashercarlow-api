// apps/swdnd/src/lib/shipTokens.test.ts
import { describe, expect, test } from 'bun:test';
import type { GridConfig } from './hex';
import {
  MAX_SYSTEM_DAMAGE, SHIP_CONDITIONS, facingAngle, footprintScale, normalizeFacing,
  rotateFacing, shipSizeCells, shipTokenScale,
} from './shipTokens';
import { shipConditionOptions } from './shipRules/constants';

const pointy: GridConfig = { orientation: 'pointy', hexSize: 32, originX: 120, originY: -40, unitsPerHex: 50, unitLabel: 'ft' };
const flat: GridConfig = { ...pointy, orientation: 'flat' };

describe('space vocabulary', () => {
  test('the condition list is the spine engine list, not a second vocabulary', () => {
    // Same strings the ShipSheet conditions menu writes into ShipPlayState.conditions.
    expect([...SHIP_CONDITIONS]).toEqual(shipConditionOptions());
    expect([...SHIP_CONDITIONS]).toEqual([
      'Ionized', 'Shocked', 'Slowed 1', 'Slowed 2', 'Slowed 3', 'Slowed 4', 'Stalled', 'Tractored',
    ]);
    expect(MAX_SYSTEM_DAMAGE).toBe(6);
  });
});

describe('footprints', () => {
  test('official scaled footprints, in cells', () => {
    expect(shipSizeCells('tiny')).toBe(1);
    expect(shipSizeCells('small')).toBe(1);
    expect(shipSizeCells('medium')).toBe(2);
    expect(shipSizeCells('large')).toBe(4);
    expect(shipSizeCells('huge')).toBe(8);
    expect(shipSizeCells('gargantuan')).toBe(16);
  });

  test('size lookup is case/space tolerant and defaults to medium', () => {
    expect(shipSizeCells('  Large ')).toBe(4);
    expect(shipSizeCells('GARGANTUAN')).toBe(16);
    expect(shipSizeCells(undefined)).toBe(2);
    expect(shipSizeCells('colossal')).toBe(2);
  });

  test('footprintScale converts a cell count to hexes across', () => {
    expect(footprintScale(1)).toBe(1);
    expect(footprintScale(2)).toBe(2);
    expect(footprintScale(4)).toBe(2);
    expect(footprintScale(8)).toBe(3);
    expect(footprintScale(16)).toBe(4);
    expect(footprintScale(0)).toBe(1);
    expect(footprintScale(Number.NaN)).toBe(1);
  });

  test('shipTokenScale composes the two', () => {
    expect(shipTokenScale('small')).toBe(1);
    expect(shipTokenScale('huge')).toBe(3);
    expect(shipTokenScale(null)).toBe(2);
  });
});

describe('facing', () => {
  test('normalizeFacing wraps in both directions', () => {
    expect(normalizeFacing(0)).toBe(0);
    expect(normalizeFacing(6)).toBe(0);
    expect(normalizeFacing(7)).toBe(1);
    expect(normalizeFacing(-1)).toBe(5);
    expect(normalizeFacing(-7)).toBe(5);
    expect(normalizeFacing(2.7)).toBe(2);
  });

  test('rotateFacing steps 60° at a time', () => {
    expect(rotateFacing(0, 1)).toBe(1);
    expect(rotateFacing(5, 1)).toBe(0);
    expect(rotateFacing(0, -1)).toBe(5);
    expect(rotateFacing(3, 3)).toBe(0);
  });

  test('facingAngle matches the pointy-top neighbor geometry (0 = east, clockwise)', () => {
    expect(facingAngle(0, pointy)).toBeCloseTo(0);
    expect(facingAngle(1, pointy)).toBeCloseTo(300);
    expect(facingAngle(2, pointy)).toBeCloseTo(240);
    expect(facingAngle(3, pointy)).toBeCloseTo(180);
    expect(facingAngle(4, pointy)).toBeCloseTo(120);
    expect(facingAngle(5, pointy)).toBeCloseTo(60);
  });

  test('flat-top grids are rotated 30°, and the origin offset is irrelevant', () => {
    expect(facingAngle(0, flat)).toBeCloseTo(30);
    expect(facingAngle(1, flat)).toBeCloseTo(330);
    expect(facingAngle(3, flat)).toBeCloseTo(210);
    expect(facingAngle(0, { ...pointy, originX: 0, originY: 0 })).toBeCloseTo(facingAngle(0, pointy));
  });

  test('out-of-range facings normalize rather than throw', () => {
    expect(facingAngle(6, pointy)).toBeCloseTo(0);
    expect(facingAngle(-1, pointy)).toBeCloseTo(60);
  });
});
