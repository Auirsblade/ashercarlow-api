// apps/swdnd/src/lib/partyCards.ts — read-only party dashboard cards.
import type { CharacterDto } from './characters';
import type { ReferenceData } from './rules/types';
import { computeSheet } from './rules';
import { classSummary } from './sheetView';

/** The slice of `play` the party rail displays. `character:updated` payloads
 * carry the full play object; extra fields are ignored. */
export interface PlayPayload {
  hp: number;
  tempHp: number;
  conditions: string[];
  exhaustion: number;
  inspiration: boolean;
}

export interface PartyCard {
  id: string;
  name: string;
  classLine: string;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  speed: number;
  passivePerception: number;
  conditions: string[];
  exhaustion: number;
  inspiration: boolean;
}

export type PendingCardPlays = Record<string, { name: string; play: PlayPayload }>;

/** One card per character. Derived fields (maxHp/ac/speed/PP/classLine) are
 * computed at load and cached — a mid-session level-up won't refresh them
 * until reload, the same trade-off as the map's vitals. */
export function cardFromCharacter(dto: CharacterDto, ref: ReferenceData): PartyCard {
  const derived = computeSheet(dto.data_json, ref);
  const play = dto.data_json.play;
  const prc = derived.skills.find((s) => s.key === 'prc');
  return {
    id: dto.id,
    name: dto.name,
    classLine: classSummary(dto.data_json, ref) || 'no class yet',
    hp: play.hp,
    maxHp: derived.maxHp,
    tempHp: play.tempHp,
    ac: derived.armorClass,
    speed: derived.speed,
    passivePerception: 10 + (prc?.bonus ?? 0),
    conditions: [...play.conditions],
    exhaustion: play.exhaustion,
    inspiration: play.inspiration,
  };
}

export function buildCards(characters: CharacterDto[], ref: ReferenceData): PartyCard[] {
  return characters.map((c) => cardFromCharacter(c, ref));
}

/** Merge a live `character:updated` payload. Unknown ids return the array unchanged. */
export function mergeCardPlay(cards: PartyCard[], characterId: string, name: string, play: PlayPayload): PartyCard[] {
  if (!cards.some((c) => c.id === characterId)) return cards;
  return cards.map((c) => (c.id === characterId
    ? {
        ...c, name, hp: play.hp, tempHp: play.tempHp,
        conditions: [...play.conditions], exhaustion: play.exhaustion, inspiration: play.inspiration,
      }
    : c));
}

/** Overlay payloads buffered while the initial load was in flight. Unknown ids are no-ops. */
export function applyPendingCardPlays(cards: PartyCard[], pending: PendingCardPlays): PartyCard[] {
  let out = cards;
  for (const [id, { name, play }] of Object.entries(pending)) out = mergeCardPlay(out, id, name, play);
  return out;
}

/** Replace-or-append one character's card — used when an event names an id not yet in the list. */
export function addCard(cards: PartyCard[], dto: CharacterDto, ref: ReferenceData): PartyCard[] {
  const card = cardFromCharacter(dto, ref);
  return cards.some((c) => c.id === card.id)
    ? cards.map((c) => (c.id === card.id ? card : c))
    : [...cards, card];
}
