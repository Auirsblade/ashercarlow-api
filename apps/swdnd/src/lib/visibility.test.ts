// apps/swdnd/src/lib/visibility.test.ts
import { describe, expect, it } from 'bun:test';
import { showHpRing, tokenVisibility } from './visibility';
import type { TokenDto } from './scenes';

const tok = (over: Partial<TokenDto>): TokenDto => ({
  id: 't1', scene_id: 's1', character_id: null, name: 'X', color: '#fff',
  faction: 'hostile', q: 0, r: 0, scale: 1, hp: null, max_hp: null,
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
