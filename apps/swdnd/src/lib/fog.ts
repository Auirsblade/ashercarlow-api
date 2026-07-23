// apps/swdnd/src/lib/fog.ts — pure revealed-set operations for fog of war.
// fog_json semantics: an EMPTY revealed set means fog is OFF (fully visible);
// the first painted reveal turns fog on. "Disable fog" = erase all reveals.
import { hexBlast, hexKey, type Hex } from './hex';

export interface FogPatch {
  reveal: string[];
  hide: string[];
}

export const toFogSet = (revealed: string[]): Set<string> => new Set(revealed);

/** Merge a reveal/hide batch into a revealed list. Hide wins ties; output is deduped + sorted. */
export function applyFogPatch(revealed: string[], patch: FogPatch): string[] {
  const set = new Set(revealed);
  for (const k of patch.reveal) set.add(k);
  for (const k of patch.hide) set.delete(k);
  return [...set].sort();
}

/** Brush footprint: all hex keys within `radius` of center (radius 0 = 1 hex, 1 = 7, 2 = 19). */
export const brushKeys = (center: Hex, radius: number): string[] =>
  hexBlast(center, radius).map(hexKey);

export const fogActive = (revealed: string[]): boolean => revealed.length > 0;

export const isRevealed = (set: Set<string>, hex: Hex): boolean => set.has(hexKey(hex));
