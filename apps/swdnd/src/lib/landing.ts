// apps/swdnd/src/lib/landing.ts — pure helpers for the landing page.
import type { CharacterDto, PlayerDto } from './characters';

export interface PlayerGroup {
  player: PlayerDto | null; // null = the trailing "unassigned" bucket
  characters: CharacterDto[];
}

/**
 * One group per player in roster order (characterless players included, so the
 * DM can still copy their invite link); characters keep list order; characters
 * with a null or unknown player_id land in a trailing { player: null } group,
 * omitted when empty.
 */
export function groupCharactersByPlayer(
  players: PlayerDto[],
  characters: CharacterDto[],
): PlayerGroup[] {
  const known = new Set(players.map((p) => p.id));
  const groups = players.map((p) => ({
    player: p as PlayerDto | null,
    characters: characters.filter((c) => c.player_id === p.id),
  }));
  const unassigned = characters.filter((c) => c.player_id === null || !known.has(c.player_id));
  if (unassigned.length > 0) groups.push({ player: null, characters: unassigned });
  return groups;
}
