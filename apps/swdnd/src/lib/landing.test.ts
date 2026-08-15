// apps/swdnd/src/lib/landing.test.ts
import { describe, expect, it } from 'bun:test';
import { groupCharactersByPlayer } from './landing';
import type { CharacterDto, PlayerDto } from './characters';

const player = (id: string, name: string): PlayerDto =>
  ({ id, campaign_id: 'camp', name, access_token: `tok-${id}`, created_at: 't' });

// Partial-but-typed factory: the grouping only reads id/name/player_id, but the
// literal must satisfy CharacterDto (tests are excluded from tsc, editors still check).
const character = (id: string, name: string, player_id: string | null): CharacterDto =>
  ({ id, campaign_id: 'camp', player_id, name, data_json: {} as CharacterDto['data_json'], created_at: 't', updated_at: 't' });

describe('groupCharactersByPlayer', () => {
  const p1 = player('p1', 'Paulina');
  const p2 = player('p2', 'Rook');

  it('groups characters under their players in roster order', () => {
    const out = groupCharactersByPlayer(
      [p1, p2],
      [character('c1', 'Kira', 'p1'), character('c2', 'Dex', 'p2'), character('c3', 'Vex', 'p1')],
    );
    expect(out.map((g) => g.player?.id)).toEqual(['p1', 'p2']);
    expect(out[0].characters.map((c) => c.id)).toEqual(['c1', 'c3']); // list order kept
    expect(out[1].characters.map((c) => c.id)).toEqual(['c2']);
  });

  it('includes characterless players with an empty group', () => {
    const out = groupCharactersByPlayer([p1], []);
    expect(out).toEqual([{ player: p1, characters: [] }]);
  });

  it('collects null and unknown player_ids into a trailing null group', () => {
    const out = groupCharactersByPlayer(
      [p1],
      [character('c1', 'Kira', 'p1'), character('c2', 'NPC', null), character('c3', 'Ghost', 'gone')],
    );
    expect(out).toHaveLength(2);
    expect(out[1].player).toBeNull();
    expect(out[1].characters.map((c) => c.id)).toEqual(['c2', 'c3']);
  });

  it('omits the null group when every character is assigned', () => {
    const out = groupCharactersByPlayer([p1], [character('c1', 'Kira', 'p1')]);
    expect(out).toHaveLength(1);
  });

  it('handles the empty campaign', () => {
    expect(groupCharactersByPlayer([], [])).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const players = [p1];
    const characters = [character('c1', 'Kira', 'p1')];
    groupCharactersByPlayer(players, characters);
    expect(players).toHaveLength(1);
    expect(characters[0].id).toBe('c1');
  });
});
