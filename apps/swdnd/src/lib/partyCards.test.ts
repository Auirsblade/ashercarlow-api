// apps/swdnd/src/lib/partyCards.test.ts
import { describe, expect, it } from 'bun:test';
import { emptyBuild } from './rules/types';
import {
  addCard, applyPendingCardPlays, buildCards, cardFromCharacter, mergeCardPlay,
  type PartyCard, type PendingCardPlays,
} from './partyCards';

const fighter = {
  id: 'fighter', name: 'Fighter', hitDie: 10, saves: ['str', 'con'],
  skillChoices: ['ath', 'prc'], skillNumber: 2,
  powercasting: { force: 'none', tech: 'none' }, superiorityProgression: 0,
};
const ref: any = {
  classes: { fighter }, archetypes: {},
  species: { human: { id: 'human', name: 'Human', walkSpeed: 30 } },
  armor: {}, weapons: {}, powers: {},
};

function dto(over: Record<string, unknown> = {}) {
  const build = emptyBuild('Lyra');
  build.identity.speciesId = 'human';
  build.abilities.base = { str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 10 };
  build.levels = [{ n: 1, classId: 'fighter', archetypeId: null, hp: 'avg' }];
  build.proficiencies.skills = ['prc'];
  build.play = { ...build.play, hp: 9, tempHp: 2, conditions: ['prone'], exhaustion: 1, inspiration: true };
  return {
    id: 'c1', campaign_id: 'camp', player_id: 'p1', name: 'Lyra',
    data_json: build, created_at: '', updated_at: '', ...over,
  } as any;
}

describe('cardFromCharacter', () => {
  it('derives display fields via computeSheet and copies play state', () => {
    const card = cardFromCharacter(dto(), ref);
    // L1 fighter, con 14: maxHp = 10 + 2. Unarmored AC = 10 + dex 2. Human speed 30.
    // Passive perception = 10 + wis mod 1 + proficiency 2.
    expect(card).toEqual({
      id: 'c1', name: 'Lyra', classLine: 'Fighter 1',
      hp: 9, maxHp: 12, tempHp: 2, ac: 12, speed: 30, passivePerception: 13,
      conditions: ['prone'], exhaustion: 1, inspiration: true,
    });
  });

  it('empty build yields the no-class fallback line and PP without proficiency', () => {
    const bare = dto({ id: 'c2', name: 'Blank' });
    bare.data_json = emptyBuild('Blank');
    const card = cardFromCharacter(bare, ref);
    expect(card.classLine).toBe('no class yet');
    expect(card.passivePerception).toBe(10); // wis 10, not proficient
  });
});

describe('mergeCardPlay', () => {
  const base = (): PartyCard[] => [cardFromCharacter(dto(), ref)];

  it('updates play fields + name, keeps derived fields cached', () => {
    const next = mergeCardPlay(base(), 'c1', 'Lyra II', {
      hp: 4, tempHp: 0, conditions: ['stunned', 'blinded'], exhaustion: 2, inspiration: false,
    });
    expect(next[0]).toMatchObject({
      name: 'Lyra II', hp: 4, tempHp: 0, conditions: ['stunned', 'blinded'],
      exhaustion: 2, inspiration: false,
      maxHp: 12, ac: 12, speed: 30, passivePerception: 13, classLine: 'Fighter 1',
    });
  });

  it('unknown id returns the same array reference', () => {
    const cards = base();
    expect(mergeCardPlay(cards, 'nope', 'X', { hp: 1, tempHp: 0, conditions: [], exhaustion: 0, inspiration: false })).toBe(cards);
  });
});

describe('applyPendingCardPlays', () => {
  it('overlays buffered payloads; unknown ids are no-ops; empty pending is identity', () => {
    const cards = buildCards([dto()], ref);
    const pending: PendingCardPlays = {
      c1: { name: 'Lyra', play: { hp: 1, tempHp: 0, conditions: [], exhaustion: 0, inspiration: false } },
      nope: { name: 'X', play: { hp: 5, tempHp: 0, conditions: [], exhaustion: 0, inspiration: false } },
    };
    const next = applyPendingCardPlays(cards, pending);
    expect(next[0].hp).toBe(1);
    expect(next).toHaveLength(1);
    expect(applyPendingCardPlays(cards, {})).toBe(cards);
  });
});

describe('addCard', () => {
  it('appends a new character and replaces an existing one', () => {
    const cards = buildCards([dto()], ref);
    const added = addCard(cards, dto({ id: 'c9', name: 'Nova' }), ref);
    expect(added).toHaveLength(2);
    expect(added[1].name).toBe('Nova');

    const replaced = addCard(added, dto({ name: 'Lyra Prime' }), ref);
    expect(replaced).toHaveLength(2);
    expect(replaced[0].name).toBe('Lyra Prime');
  });
});
