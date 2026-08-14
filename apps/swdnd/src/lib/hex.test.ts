// apps/swdnd/src/lib/hex.test.ts
import { test, expect } from 'bun:test';
import {
  AXIAL_DIRS, hexToPixel, pixelToHex, hexRound, hexDistance, hexCorners,
  hexKey, parseHexKey, hexLine, hexBlast, hexRing, hexWedge,
  gridUnits, hexesToUnits,
  type GridConfig,
} from './hex';

const flat: GridConfig = { orientation: 'flat', hexSize: 10, originX: 0, originY: 0, unitsPerHex: 5, unitLabel: 'ft' };
const pointy: GridConfig = { ...flat, orientation: 'pointy' };
const offset: GridConfig = { ...flat, originX: 100, originY: 50 };

test('hexToPixel: origin and axis hexes, both orientations', () => {
  expect(hexToPixel({ q: 0, r: 0 }, flat)).toEqual({ x: 0, y: 0 });
  // flat: x = size * 3/2 * q ; y = size * (sqrt3/2 * q + sqrt3 * r)
  const f = hexToPixel({ q: 1, r: 0 }, flat);
  expect(f.x).toBeCloseTo(15);
  expect(f.y).toBeCloseTo(10 * Math.sqrt(3) / 2);
  // pointy: x = size * (sqrt3 * q + sqrt3/2 * r) ; y = size * 3/2 * r
  const p = hexToPixel({ q: 0, r: 1 }, pointy);
  expect(p.x).toBeCloseTo(10 * Math.sqrt(3) / 2);
  expect(p.y).toBeCloseTo(15);
});

test('origin offset shifts pixel space', () => {
  expect(hexToPixel({ q: 0, r: 0 }, offset)).toEqual({ x: 100, y: 50 });
});

test('pixelToHex inverts hexToPixel exactly on centers, both orientations', () => {
  for (const cfg of [flat, pointy, offset]) {
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        const px = hexToPixel({ q, r }, cfg);
        expect(pixelToHex(px.x, px.y, cfg)).toEqual({ q, r });
      }
    }
  }
});

test('pixelToHex snaps points near a center to that hex', () => {
  const c = hexToPixel({ q: 2, r: -1 }, pointy);
  expect(pixelToHex(c.x + 3, c.y - 3, pointy)).toEqual({ q: 2, r: -1 });
});

test('hexRound rounds fractional cube coords to the nearest hex', () => {
  expect(hexRound(0.1, -0.1)).toEqual({ q: 0, r: 0 });
  expect(hexRound(0.9, 0.05)).toEqual({ q: 1, r: 0 });
});

test('hexDistance', () => {
  expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
  expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(3);
  expect(hexDistance({ q: 0, r: 0 }, { q: -2, r: 2 })).toBe(2);
  expect(hexDistance({ q: -1, r: -1 }, { q: 1, r: 1 })).toBe(4);
});

test('hexCorners: 6 corners at hexSize from the center', () => {
  for (const cfg of [flat, pointy]) {
    const corners = hexCorners({ q: 0, r: 0 }, cfg);
    expect(corners).toHaveLength(6);
    for (const c of corners) {
      expect(Math.hypot(c.x, c.y)).toBeCloseTo(10);
    }
  }
  // flat-top: first corner at angle 0 → (size, 0); pointy: rotated -30° → angle -30
  expect(hexCorners({ q: 0, r: 0 }, flat)[0].x).toBeCloseTo(10);
  expect(hexCorners({ q: 0, r: 0 }, flat)[0].y).toBeCloseTo(0);
});

test('hexKey round-trips', () => {
  expect(hexKey({ q: -2, r: 7 })).toBe('-2,7');
  expect(parseHexKey('-2,7')).toEqual({ q: -2, r: 7 });
});

test('hexLine: endpoints included, consecutive hexes adjacent, length = distance + 1', () => {
  const line = hexLine({ q: 0, r: 0 }, { q: 3, r: -2 });
  expect(line[0]).toEqual({ q: 0, r: 0 });
  expect(line[line.length - 1]).toEqual({ q: 3, r: -2 });
  expect(line).toHaveLength(hexDistance({ q: 0, r: 0 }, { q: 3, r: -2 }) + 1);
  for (let i = 1; i < line.length; i++) {
    expect(hexDistance(line[i - 1], line[i])).toBe(1);
  }
});

test('hexBlast: correct counts (1+3r(r+1)) and every member within range', () => {
  expect(hexBlast({ q: 0, r: 0 }, 0)).toEqual([{ q: 0, r: 0 }]);
  expect(hexBlast({ q: 0, r: 0 }, 1)).toHaveLength(7);
  expect(hexBlast({ q: 2, r: -1 }, 2)).toHaveLength(19);
  for (const h of hexBlast({ q: 2, r: -1 }, 2)) {
    expect(hexDistance({ q: 2, r: -1 }, h)).toBeLessThanOrEqual(2);
  }
});

test('hexRing: 6r hexes exactly at distance r', () => {
  expect(hexRing({ q: 0, r: 0 }, 1)).toHaveLength(6);
  const ring3 = hexRing({ q: 1, r: 1 }, 3);
  expect(ring3).toHaveLength(18);
  for (const h of ring3) expect(hexDistance({ q: 1, r: 1 }, h)).toBe(3);
});

test('hexWedge: 60° integer cone between adjacent direction rays', () => {
  // dir 0 = (+1,0), dir 1 = (+1,-1): wedge 0 of length 2 =
  // a*(1,0) + b*(1,-1), a,b >= 0, 0 < a+b <= 2 (origin excluded)
  const w = hexWedge({ q: 0, r: 0 }, 0, 2);
  const keys = new Set(w.map((h) => `${h.q},${h.r}`));
  expect(keys).toEqual(new Set(['1,0', '2,0', '1,-1', '2,-1', '2,-2']));
  // length L wedge has L(L+3)/2 hexes… for L=2: 5 ✓; check L=3 count too
  expect(hexWedge({ q: 0, r: 0 }, 0, 3)).toHaveLength(9);
  // origin translates, direction wraps: dir 5 = (0,+1), dir 0 = (1,0),
  // so L=1 wedge = both unit rays (L(L+3)/2 = 2 hexes)
  const w3 = hexWedge({ q: 2, r: 2 }, 5, 1);
  expect(w3).toHaveLength(2);
  const w3Keys = new Set(w3.map((h) => `${h.q},${h.r}`));
  expect(w3Keys).toEqual(new Set(['2,3', '3,2']));
});

test('AXIAL_DIRS is the canonical 6-neighbor set', () => {
  expect(AXIAL_DIRS).toEqual([
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ]);
});

test('gridUnits reads calibration and defaults tolerantly', () => {
  expect(gridUnits({ unitsPerHex: 50, unitLabel: 'ft' })).toEqual({ per: 50, label: 'ft' });
  expect(gridUnits(null)).toEqual({ per: 5, label: 'ft' });
  expect(gridUnits(undefined)).toEqual({ per: 5, label: 'ft' });
  // legacy / hand-edited grid JSON
  expect(gridUnits({ unitsPerHex: 0, unitLabel: '' } as any)).toEqual({ per: 5, label: 'ft' });
  expect(gridUnits({ unitsPerHex: Number.NaN, unitLabel: 'm' } as any)).toEqual({ per: 5, label: 'm' });
});

test('hexesToUnits scales hex distance into grid units', () => {
  expect(hexesToUnits(3, { unitsPerHex: 50, unitLabel: 'ft' })).toBe(150);
  expect(hexesToUnits(3, undefined)).toBe(15);
});
