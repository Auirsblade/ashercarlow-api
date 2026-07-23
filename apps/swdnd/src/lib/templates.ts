// apps/swdnd/src/lib/templates.ts — AoE footprint geometry (pure).
import { AXIAL_DIRS, hexBlast, hexLine, hexToPixel, hexWedge, type Hex } from './hex';
import type { GridConfig } from './hex';
import type { TemplateDto } from './scenes';

/** The hexes a template covers. Line templates without an endpoint cover nothing. */
export function templateHexes(t: TemplateDto): Hex[] {
  switch (t.kind) {
    case 'blast':
      return hexBlast({ q: t.q, r: t.r }, t.size);
    case 'cone':
      return hexWedge({ q: t.q, r: t.r }, t.dir, t.size);
    case 'line':
      return t.q2 == null || t.r2 == null ? [] : hexLine({ q: t.q, r: t.r }, { q: t.q2, r: t.r2 });
  }
}

/**
 * Snap a drag vector (map-pixel point relative to the origin hex's center) to
 * the nearest of the six hex directions for the grid's orientation.
 */
export function dirFromPoint(origin: Hex, px: number, py: number, grid: GridConfig): number {
  const o = hexToPixel(origin, grid);
  const vx = px - o.x;
  const vy = py - o.y;
  if (vx === 0 && vy === 0) return 0;
  let best = 0;
  let bestDot = -Infinity;
  for (let d = 0; d < 6; d++) {
    const n = hexToPixel({ q: origin.q + AXIAL_DIRS[d].q, r: origin.r + AXIAL_DIRS[d].r }, grid);
    const nx = n.x - o.x;
    const ny = n.y - o.y;
    const len = Math.hypot(nx, ny) || 1;
    const dot = (vx * nx + vy * ny) / len; // cosine similarity × |v| — |v| constant across d
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return best;
}
