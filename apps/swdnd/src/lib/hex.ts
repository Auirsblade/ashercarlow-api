// apps/swdnd/src/lib/hex.ts
// Axial-coordinate hex math (Red Blob Games conventions). Pure — no React/IO.
export interface Hex { q: number; r: number }
export interface Point { x: number; y: number }
export type HexOrientation = 'flat' | 'pointy';

/** Per-scene grid calibration, in map-image pixel space. */
export interface GridConfig {
  orientation: HexOrientation;
  hexSize: number;   // center-to-corner radius, px
  originX: number;   // pixel position of hex (0,0)'s center
  originY: number;
  unitsPerHex: number;
  unitLabel: string;
}

const SQRT3 = Math.sqrt(3);

/** The 6 axial neighbor directions, counter-clockwise from +q. */
export const AXIAL_DIRS: Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function hexToPixel(h: Hex, cfg: GridConfig): Point {
  const s = cfg.hexSize;
  if (cfg.orientation === 'flat') {
    return {
      x: cfg.originX + s * (3 / 2) * h.q,
      y: cfg.originY + s * ((SQRT3 / 2) * h.q + SQRT3 * h.r),
    };
  }
  return {
    x: cfg.originX + s * (SQRT3 * h.q + (SQRT3 / 2) * h.r),
    y: cfg.originY + s * (3 / 2) * h.r,
  };
}

/** Round fractional axial coords to the nearest hex (via cube rounding). */
export function hexRound(qf: number, rf: number): Hex {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // || 0 normalizes -0 so hex keys and toEqual comparisons stay stable
  return { q: q || 0, r: r || 0 };
}

export function pixelToHex(x: number, y: number, cfg: GridConfig): Hex {
  const s = cfg.hexSize;
  const px = x - cfg.originX;
  const py = y - cfg.originY;
  if (cfg.orientation === 'flat') {
    return hexRound(((2 / 3) * px) / s, ((-1 / 3) * px + (SQRT3 / 3) * py) / s);
  }
  return hexRound(((SQRT3 / 3) * px - (1 / 3) * py) / s, ((2 / 3) * py) / s);
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** The 6 corner points of a hex, for grid/polygon rendering. */
export function hexCorners(h: Hex, cfg: GridConfig): Point[] {
  const center = hexToPixel(h, cfg);
  const startDeg = cfg.orientation === 'flat' ? 0 : -30;
  return Array.from({ length: 6 }, (_, i) => {
    const rad = (Math.PI / 180) * (startDeg + 60 * i);
    return { x: center.x + cfg.hexSize * Math.cos(rad), y: center.y + cfg.hexSize * Math.sin(rad) };
  });
}

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;
export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/** Every hex on the straight line a→b inclusive (cube lerp + round). */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(hexRound(a.q + (b.q - a.q) * t, a.r + (b.r - a.r) * t));
  }
  return out;
}

/** All hexes within `radius` of center (a "blast"): 1 + 3r(r+1) hexes. */
export function hexBlast(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

/** The 6r hexes exactly at `radius` from center. */
export function hexRing(center: Hex, radius: number): Hex[] {
  if (radius <= 0) return [{ ...center }];
  const out: Hex[] = [];
  let h: Hex = { q: center.q + AXIAL_DIRS[4].q * radius, r: center.r + AXIAL_DIRS[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push({ ...h });
      h = { q: h.q + AXIAL_DIRS[side].q, r: h.r + AXIAL_DIRS[side].r };
    }
  }
  return out;
}

/**
 * The 60° wedge ("hex cone") from origin along direction `dir` (0–5):
 * every hex expressible as a·DIRS[dir] + b·DIRS[dir+1] with a,b ≥ 0 and
 * 0 < a+b ≤ length. Origin excluded. L(L+3)/2 hexes for length L.
 */
export function hexWedge(origin: Hex, dir: number, length: number): Hex[] {
  const u = AXIAL_DIRS[((dir % 6) + 6) % 6];
  const v = AXIAL_DIRS[(((dir + 1) % 6) + 6) % 6];
  const out: Hex[] = [];
  for (let a = 0; a <= length; a++) {
    for (let b = 0; a + b <= length; b++) {
      if (a + b === 0) continue;
      out.push({ q: origin.q + a * u.q + b * v.q, r: origin.r + a * u.r + b * v.r });
    }
  }
  return out;
}
