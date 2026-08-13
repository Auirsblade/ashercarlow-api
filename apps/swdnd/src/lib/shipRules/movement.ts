import type { ShipBuild, ShipReferenceData } from './types';

/**
 * Flying speed in feet, from the size row's baseSpaceSpeed.
 *
 * The spec allows folding in "modification effects when representable as
 * scalars" — VERIFIED at plan time that none of the 257 ingested
 * starship_modifications rows encodes a machine-readable speed delta (every
 * effect is prose), so the spine reads the size row only. A house table that
 * wants a different number uses the `speed` override.
 */
export function shipSpeed(build: ShipBuild, ref: ShipReferenceData): number {
  return ref.sizes[build.identity.sizeId]?.spaceSpeed ?? 0;
}

/** Turning speed in feet, from the size row's baseTurnSpeed. Same caveat as shipSpeed. */
export function shipTurnSpeed(build: ShipBuild, ref: ShipReferenceData): number {
  return ref.sizes[build.identity.sizeId]?.turnSpeed ?? 0;
}
