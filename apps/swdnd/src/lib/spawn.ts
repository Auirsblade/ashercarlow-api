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

/** Token-create payloads for `count` copies of a statblock: hostile faction,
 * hp/max prefilled, names suffixed `#2, #3…` for multiples. */
export function spawnBodies(view: MonsterView, count: number, positions: Hex[]): SpawnBody[] {
  return positions.slice(0, count).map((pos, i) => ({
    name: i === 0 ? view.name : `${view.name} #${i + 1}`,
    faction: 'hostile',
    q: pos.q,
    r: pos.r,
    hp: view.hp,
    max_hp: view.hp,
  }));
}
