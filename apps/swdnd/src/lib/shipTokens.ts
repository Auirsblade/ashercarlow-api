// apps/swdnd/src/lib/shipTokens.ts — pure ship-token rules: footprint sizing and
// hex facing, plus the map's import surface for the ship condition vocabulary.
// No React, no IO.
import { AXIAL_DIRS, hexToPixel, type GridConfig } from './hex';
import { shipConditionOptions } from './shipRules/constants';

/**
 * The SOTG space conditions, taken from the spine's engine constants rather than
 * redeclared: plain conditions plus the levelled 'Slowed 1'…'Slowed 4'. Both the
 * ShipSheet menu and the map's right-click menu write into the same
 * ShipPlayState.conditions array, so they must offer identical strings.
 */
export const SHIP_CONDITIONS: readonly string[] = shipConditionOptions();
export type ShipCondition = string;

/** System damage is a 0-6 counter on the ship, not a condition string. */
export { MAX_SYSTEM_DAMAGE } from './shipRules/constants';

/** Official scaled footprints, in grid cells, keyed by chassis size. */
export const SHIP_SIZE_CELLS: Record<string, number> = {
  tiny: 1, small: 1, medium: 2, large: 4, huge: 8, gargantuan: 16,
};

/** Cells for a chassis size string; unknown/missing sizes fall back to medium. */
export function shipSizeCells(size: string | null | undefined): number {
  const key = String(size ?? '').trim().toLowerCase();
  return SHIP_SIZE_CELLS[key] ?? SHIP_SIZE_CELLS.medium;
}

/**
 * Cells (an area) → token `scale` (hexes across), because TokenGlyph draws
 * radius = hexSize * 0.72 * scale. Storing the raw cell count would render a
 * Gargantuan ship as a 23-hex-radius disc.
 */
export const footprintScale = (cells: number): number =>
  (Number.isFinite(cells) && cells > 0 ? Math.max(1, Math.ceil(Math.sqrt(cells))) : 1);

/** The token `scale` a ship of this chassis size should spawn with. */
export const shipTokenScale = (size: string | null | undefined): number =>
  footprintScale(shipSizeCells(size));

/** Any integer (or junk) → a facing in 0-5. */
export function normalizeFacing(facing: number): number {
  const n = Number.isFinite(facing) ? Math.trunc(facing) : 0;
  return ((n % 6) + 6) % 6;
}

/** Rotate by whole 60° steps. */
export const rotateFacing = (facing: number, delta: number): number =>
  normalizeFacing(normalizeFacing(facing) + Math.trunc(delta));

/**
 * Screen angle of a facing, in degrees within [0, 360): 0 = +x (east),
 * increasing clockwise (SVG y-down). Derived from the grid's own neighbor
 * geometry so it can never drift from hexToPixel or the orientation setting.
 */
export function facingAngle(facing: number, cfg: GridConfig): number {
  const dir = AXIAL_DIRS[normalizeFacing(facing)];
  const p = hexToPixel(dir, { ...cfg, originX: 0, originY: 0 });
  const deg = (Math.atan2(p.y, p.x) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}
