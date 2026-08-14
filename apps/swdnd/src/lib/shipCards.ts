// apps/swdnd/src/lib/shipCards.ts — read-only fleet dashboard cards, the ship
// twin of partyCards.ts. Derived maxima are computed at load and cached: a
// mid-session refit won't refresh them until reload, the same documented
// trade-off the party rail accepts.
import type { StarshipDto } from './starships';
import type { ShipReferenceData } from './shipRules/types';
import type { PendingShipPlays, ShipPlayLike } from './shipVitals';
import { computeShip } from './shipRules';

// The slice of ship `play` the fleet rail displays is exactly sub-project 3's
// ShipPlayLike, and the buffered-play cache is its PendingShipPlays — one cache
// shape for the map and the DM screen instead of two near-identical ones.
// `ship:updated` payloads carry the full play object; extra fields are ignored.

export interface ShipCard {
  id: string;
  name: string;
  tier: number;
  sizeName: string;
  hull: number;
  maxHull: number;
  shields: number;
  maxShields: number;
  conditions: string[];
  systemDamage: number;
}

export function cardFromShip(dto: StarshipDto, ref: ShipReferenceData): ShipCard {
  const derived = computeShip(dto.data_json, ref);
  const { identity, play } = dto.data_json;
  return {
    id: dto.id,
    name: dto.name,
    tier: identity.tier,
    // ADAPTER: the only ShipReferenceData field this module reads (see PREFLIGHT).
    sizeName: ref.sizes[identity.sizeId]?.name ?? '',
    hull: play.hull,
    maxHull: derived.maxHull,
    shields: play.shields,
    maxShields: derived.maxShields,
    conditions: [...play.conditions],
    systemDamage: play.systemDamage,
  };
}

export function buildShipCards(ships: StarshipDto[], ref: ShipReferenceData): ShipCard[] {
  return ships.map((s) => cardFromShip(s, ref));
}

/** Merge a live `ship:updated` payload. Unknown ids return the array unchanged. */
export function mergeShipCardPlay(
  cards: ShipCard[],
  shipId: string,
  name: string,
  play: ShipPlayLike,
): ShipCard[] {
  if (!cards.some((c) => c.id === shipId)) return cards;
  return cards.map((c) => (c.id === shipId
    ? {
        ...c, name, hull: play.hull, shields: play.shields,
        conditions: [...play.conditions], systemDamage: play.systemDamage,
      }
    : c));
}

/** Replace-or-append one ship's card — used when an event names an id not yet listed. */
export function addShipCard(cards: ShipCard[], dto: StarshipDto, ref: ShipReferenceData): ShipCard[] {
  const card = cardFromShip(dto, ref);
  return cards.some((c) => c.id === card.id)
    ? cards.map((c) => (c.id === card.id ? card : c))
    : [...cards, card];
}

/**
 * Overlay plays buffered while the initial load was in flight, from the SHARED
 * PendingShipPlays cache (lib/shipVitals.ts). That cache stores play state only,
 * so a rename carried by a buffered event rides in the parallel `names` map;
 * ships missing from it keep the name they loaded with. Unknown ids are no-ops.
 */
export function applyPendingShipCards(
  cards: ShipCard[],
  pending: PendingShipPlays,
  names: Record<string, string> = {},
): ShipCard[] {
  let out = cards;
  for (const [id, play] of Object.entries(pending)) {
    const cur = out.find((c) => c.id === id);
    if (!cur) continue;
    out = mergeShipCardPlay(out, id, names[id] ?? cur.name, play);
  }
  return out;
}
