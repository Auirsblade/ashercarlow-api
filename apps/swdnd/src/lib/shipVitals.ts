// apps/swdnd/src/lib/shipVitals.ts — live hull/shields/conditions for ship-bound
// tokens. The character-side twin of lib/vitals.ts: maxima are computed once at
// load and cached; ship:updated then tracks the play document.
// Maxima are INJECTED (never imported from shipRules) so this module stays pure
// and testable without a ShipReferenceData fixture.
import { MAX_SYSTEM_DAMAGE } from './shipTokens';
import type { TokenDto } from './scenes';

/** The slice of ShipPlayState the map cares about. */
export interface ShipPlayLike { hull: number; shields: number; conditions: string[]; systemDamage: number }
export interface ShipVitals {
  hull: number; maxHull: number; shields: number; maxShields: number;
  conditions: string[]; systemDamage: number;
}
/** The slice of StarshipDto the map cares about. */
export interface ShipSource { id: string; data_json: { play: ShipPlayLike } }
export interface ShipMaxima { maxHull: number; maxShields: number }
export type PendingShipPlays = Record<string, ShipPlayLike>;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const counter = (v: unknown): number =>
  Math.min(MAX_SYSTEM_DAMAGE, Math.max(0, Math.round(num(v))));

/** Build one vitals record, tolerating legacy or partial play documents. */
export function shipVitalsFrom(
  play: Partial<ShipPlayLike> | null | undefined,
  max: Partial<ShipMaxima> | null | undefined,
): ShipVitals {
  return {
    hull: num(play?.hull),
    maxHull: Math.max(0, num(max?.maxHull)),
    shields: num(play?.shields),
    maxShields: Math.max(0, num(max?.maxShields)),
    conditions: strings(play?.conditions),
    systemDamage: counter(play?.systemDamage),
  };
}

/** Initial snapshot: `maxima` supplies computeShip's maxHull/maxShields per ship. */
export function buildShipVitals<S extends ShipSource>(
  ships: S[],
  maxima: (ship: S) => ShipMaxima,
): Record<string, ShipVitals> {
  const out: Record<string, ShipVitals> = {};
  for (const s of ships) out[s.id] = shipVitalsFrom(s.data_json?.play, maxima(s));
  return out;
}

/** Adopt one ship (e.g. created after load) without disturbing the others. */
export function addShipVitals<S extends ShipSource>(
  vitals: Record<string, ShipVitals>,
  ship: S,
  maxima: (ship: S) => ShipMaxima,
): Record<string, ShipVitals> {
  return { ...vitals, [ship.id]: shipVitalsFrom(ship.data_json?.play, maxima(ship)) };
}

/**
 * Merge a `ship:updated` play payload. Maxima stay as computed at load — a
 * mid-session refit won't refresh them until reload (same accepted trade-off
 * as character maxHp in lib/vitals.ts).
 */
export function mergeShipPlay(
  vitals: Record<string, ShipVitals>,
  shipId: string,
  play: Partial<ShipPlayLike>,
): Record<string, ShipVitals> {
  const cur = vitals[shipId];
  if (!cur) return vitals;
  return {
    ...vitals,
    [shipId]: { ...shipVitalsFrom(play, cur), maxHull: cur.maxHull, maxShields: cur.maxShields },
  };
}

/** Overlay payloads buffered while the ship load was in flight. Unknown ids are no-ops. */
export function applyPendingShipPlays(
  vitals: Record<string, ShipVitals>,
  pending: PendingShipPlays,
): Record<string, ShipVitals> {
  let out = vitals;
  for (const [id, play] of Object.entries(pending)) out = mergeShipPlay(out, id, play);
  return out;
}

/** A ship token's vitals, or null when it isn't one (or its ship isn't loaded). */
export function tokenShipVitals(
  token: Pick<TokenDto, 'ship_id'>,
  vitals: Record<string, ShipVitals>,
): ShipVitals | null {
  return token.ship_id ? vitals[token.ship_id] ?? null : null;
}

/** Ships this player crews — the client mirror of access.ts's playerCrewsShip. */
export function crewedShipIds(
  ships: { id: string; crew?: { character_id: string }[] }[],
  ownCharacterIds: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const s of ships) {
    if ((s.crew ?? []).some((c) => ownCharacterIds.has(c.character_id))) out.add(s.id);
  }
  return out;
}

/** Status-ring labels for a ship: its conditions plus a `sys N` chip when damaged. */
export const shipStatusNames = (vitals: ShipVitals): string[] =>
  (vitals.systemDamage > 0 ? [...vitals.conditions, `sys ${vitals.systemDamage}`] : [...vitals.conditions]);
