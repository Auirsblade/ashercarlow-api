// apps/swdnd/src/lib/fog.test.ts
import { describe, expect, it } from 'bun:test';
import { applyFogPatch, brushKeys, fogActive, isRevealed, toFogSet } from './fog';

describe('fog set ops', () => {
  it('toFogSet builds a Set of keys', () => {
    const s = toFogSet(['0,0', '1,-1']);
    expect(s.has('0,0')).toBe(true);
    expect(s.has('1,-1')).toBe(true);
    expect(s.size).toBe(2);
  });

  it('applyFogPatch adds reveals, removes hides, dedupes, and sorts deterministically', () => {
    const next = applyFogPatch(['0,0', '1,0'], { reveal: ['1,0', '2,0', '0,1'], hide: ['0,0'] });
    expect(next).toEqual(['0,1', '1,0', '2,0']);
  });

  it('applyFogPatch with empty patch is identity (but normalized)', () => {
    expect(applyFogPatch(['1,0', '0,0', '1,0'], { reveal: [], hide: [] })).toEqual(['0,0', '1,0']);
  });

  it('hide wins when a key is in both lists', () => {
    expect(applyFogPatch([], { reveal: ['3,3'], hide: ['3,3'] })).toEqual([]);
  });

  it('brushKeys radius 0 is just the center; radius 1 is 7 hexes', () => {
    expect(brushKeys({ q: 2, r: -1 }, 0)).toEqual(['2,-1']);
    const b1 = brushKeys({ q: 0, r: 0 }, 1);
    expect(b1.length).toBe(7);
    expect(b1).toContain('0,0');
    expect(b1).toContain('1,-1');
  });

  it('fogActive: empty set means fog OFF', () => {
    expect(fogActive([])).toBe(false);
    expect(fogActive(['0,0'])).toBe(true);
  });

  it('isRevealed checks membership against a Set', () => {
    const s = toFogSet(['0,0']);
    expect(isRevealed(s, { q: 0, r: 0 })).toBe(true);
    expect(isRevealed(s, { q: 1, r: 0 })).toBe(false);
  });
});
