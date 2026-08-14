// apps/swdnd/src/lib/visibility.test.ts
import { describe, expect, it } from 'bun:test';
import { isOwnToken, showHpRing, tokenVisibility } from './visibility';
import type { TokenDto } from './scenes';

const tok = (over: Partial<TokenDto>): TokenDto => ({
  id: 't1', scene_id: 's1', character_id: null, ship_id: null, name: 'X', color: '#fff',
  faction: 'hostile', q: 0, r: 0, scale: 1, facing: 0, hp: null, max_hp: null,
  conditions_json: [], hidden: 0, image_path: null, created_at: '', updated_at: '',
  ...over,
});

const ctx = (over: Partial<{ isDm: boolean; revealed: string[]; ownCharacterIds: Set<string> }> = {}) => ({
  isDm: false, revealed: [] as string[], ownCharacterIds: new Set<string>(), ...over,
});

describe('tokenVisibility', () => {
  it('DM sees everything; hidden tokens are flagged dimmed', () => {
    expect(tokenVisibility(tok({}), ctx({ isDm: true }))).toEqual({ visible: true, dimmed: false });
    expect(tokenVisibility(tok({ hidden: 1 }), ctx({ isDm: true }))).toEqual({ visible: true, dimmed: true });
  });

  it('players never see hidden tokens', () => {
    expect(tokenVisibility(tok({ hidden: 1 }), ctx()).visible).toBe(false);
  });

  it('fog off (empty revealed): players see all non-hidden tokens', () => {
    expect(tokenVisibility(tok({ q: 5, r: 5 }), ctx()).visible).toBe(true);
  });

  it('fog on: players see tokens only on revealed hexes', () => {
    const c = ctx({ revealed: ['0,0'] });
    expect(tokenVisibility(tok({ q: 0, r: 0 }), c).visible).toBe(true);
    expect(tokenVisibility(tok({ q: 1, r: 0 }), c).visible).toBe(false);
  });

  it('fog on: own character token is always visible', () => {
    const c = ctx({ revealed: ['9,9'], ownCharacterIds: new Set(['c1']) });
    expect(tokenVisibility(tok({ character_id: 'c1', q: 0, r: 0 }), c).visible).toBe(true);
  });
});

describe('showHpRing', () => {
  it('DM sees hp rings on all factions', () => {
    expect(showHpRing(tok({ faction: 'hostile' }), true)).toBe(true);
    expect(showHpRing(tok({ faction: 'friendly' }), true)).toBe(true);
  });
  it('players see hp rings on friendly tokens only', () => {
    expect(showHpRing(tok({ faction: 'friendly' }), false)).toBe(true);
    expect(showHpRing(tok({ faction: 'hostile' }), false)).toBe(false);
    expect(showHpRing(tok({ faction: 'neutral' }), false)).toBe(false);
  });
});

describe('isOwnToken', () => {
  const own = { ownCharacterIds: new Set(['c1']), ownShipIds: new Set(['s1']) };

  it('is true for an owned character token and a crewed ship token', () => {
    expect(isOwnToken(tok({ character_id: 'c1' }), own)).toBe(true);
    expect(isOwnToken(tok({ ship_id: 's1' }), own)).toBe(true);
  });

  it('is false for someone else’s character, an uncrewed ship, and a plain token', () => {
    expect(isOwnToken(tok({ character_id: 'c9' }), own)).toBe(false);
    expect(isOwnToken(tok({ ship_id: 's9' }), own)).toBe(false);
    expect(isOwnToken(tok({}), own)).toBe(false);
  });

  it('tolerates a context with no ownShipIds (legacy call sites)', () => {
    expect(isOwnToken(tok({ ship_id: 's1' }), { ownCharacterIds: new Set() })).toBe(false);
  });
});

describe('tokenVisibility — crewed ships', () => {
  it('a player always sees their crewed ship, even under unrevealed fog', () => {
    const t = tok({ ship_id: 's1', q: 9, r: 9 });
    const ctx = { isDm: false, revealed: ['0,0'], ownCharacterIds: new Set<string>(), ownShipIds: new Set(['s1']) };
    expect(tokenVisibility(t, ctx)).toEqual({ visible: true, dimmed: false });
  });

  it('someone else’s ship under fog stays hidden', () => {
    const t = tok({ ship_id: 's9', q: 9, r: 9 });
    const ctx = { isDm: false, revealed: ['0,0'], ownCharacterIds: new Set<string>(), ownShipIds: new Set(['s1']) };
    expect(tokenVisibility(t, ctx)).toEqual({ visible: false, dimmed: false });
  });

  it('a hidden ship token is still hidden from players', () => {
    const t = tok({ ship_id: 's1', hidden: 1 });
    const ctx = { isDm: false, revealed: [], ownCharacterIds: new Set<string>(), ownShipIds: new Set(['s1']) };
    expect(tokenVisibility(t, ctx).visible).toBe(false);
  });
});
