// apps/swdnd/src/lib/spawn.ts — pure spawn placement + token payloads.
import { hexRing, type Hex } from './hex';
import type { MonsterView } from './monsters';

/** First `count` hexes of a compact center-out cluster: the center, then each
 * ring outward in hexRing order. The DM drags tokens from there. */
export function spawnPositions(center: Hex, count: number): Hex[] {
  const out: Hex[] = [];
  for (let radius = 0; out.length < count; radius++) {
    for (const h of hexRing(center, radius)) {
      if (out.length >= count) break;
      out.push(h);
    }
  }
  return out;
}

export interface SpawnBody {
  name: string;
  faction: 'hostile';
  q: number;
  r: number;
  hp: number | null;
  max_hp: number | null;
}

/** `Name`, `Name #2`, `Name #3`… for multi-copy spawns. */
export function copyName(base: string, index: number): string {
  return index === 0 ? base : `${base} #${index + 1}`;
}

/** Token-create payloads for `count` copies of a statblock: hostile faction,
 * hp/max prefilled, names suffixed `#2, #3…` for multiples. */
export function spawnBodies(view: MonsterView, count: number, positions: Hex[]): SpawnBody[] {
  return positions.slice(0, count).map((pos, i) => ({
    name: copyName(view.name, i),
    faction: 'hostile',
    q: pos.q,
    r: pos.r,
    hp: view.hp,
    max_hp: view.hp,
  }));
}

export interface ShipSpawnBody {
  name: string;
  faction: 'hostile';
  q: number;
  r: number;
  hp: number | null;
  max_hp: number | null;
  /** Binds the token to its starship row (sub-project 3). */
  ship_id: string;
  facing: number;
  /** Footprint span in hexes across — shipTokenScale(sizeKey), sub-project 3. */
  scale: number;
}

/** Token payload for one spawned ship. Each spawn owns a real `starship` row,
 * so hp mirrors that ship's hull and the token carries the binding, facing and
 * the chassis footprint sub-project 3 spawns map-side ships with. */
export function shipSpawnBody(
  shipId: string,
  name: string,
  hull: number,
  maxHull: number,
  pos: Hex,
  facing = 0,
  scale = 1,
): ShipSpawnBody {
  return { name, faction: 'hostile', q: pos.q, r: pos.r, hp: hull, max_hp: maxHull, ship_id: shipId, facing, scale };
}
