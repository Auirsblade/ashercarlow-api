// apps/swdnd/src/lib/vitals.test.ts
import { describe, expect, it } from 'bun:test';
import { mergePlay, tokenVitals, type Vitals } from './vitals';
import type { TokenDto } from './scenes';

const baseToken = (over: Partial<TokenDto>): TokenDto => ({
  id: 't1', scene_id: 's1', character_id: null, name: 'X', color: '#fff',
  faction: 'hostile', q: 0, r: 0, scale: 1, hp: null, max_hp: null,
  conditions_json: [], hidden: 0, image_path: null, created_at: '', updated_at: '',
  ...over,
});

describe('mergePlay', () => {
  it('updates hp and conditions for a known character, keeps cached maxHp', () => {
    const v: Record<string, Vitals> = { c1: { hp: 10, maxHp: 24, conditions: [] } };
    const next = mergePlay(v, 'c1', { hp: 7, conditions: ['stunned'] });
    expect(next.c1).toEqual({ hp: 7, maxHp: 24, conditions: ['stunned'] });
    expect(v.c1.hp).toBe(10); // immutably
  });

  it('ignores unknown characters', () => {
    const v: Record<string, Vitals> = {};
    expect(mergePlay(v, 'nope', { hp: 1, conditions: [] })).toBe(v);
  });
});

describe('tokenVitals', () => {
  it('character token reads the vitals map', () => {
    const v = { c1: { hp: 7, maxHp: 24, conditions: ['stunned'] } };
    const t = baseToken({ character_id: 'c1', hp: 99, max_hp: 99, conditions_json: ['ignored'] });
    expect(tokenVitals(t, v)).toEqual({ hp: 7, maxHp: 24, conditions: ['stunned'] });
  });

  it('character token with no loaded vitals yields nulls (ring hidden, not wrong)', () => {
    const t = baseToken({ character_id: 'c-unloaded' });
    expect(tokenVitals(t, {})).toEqual({ hp: null, maxHp: null, conditions: [] });
  });

  it('NPC token reads its own columns', () => {
    const t = baseToken({ hp: 3, max_hp: 12, conditions_json: ['prone'] });
    expect(tokenVitals(t, {})).toEqual({ hp: 3, maxHp: 12, conditions: ['prone'] });
  });
});
