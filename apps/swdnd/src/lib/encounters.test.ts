// apps/swdnd/src/lib/encounters.test.ts
import { describe, expect, it } from 'bun:test';
import { addMonster, removeMonster, setCount, totalCount, type EncounterMonster } from './encounters';

const base: EncounterMonster[] = [{ monsterId: 'a', count: 2 }, { monsterId: 'b', count: 1 }];

describe('encounter monster-list helpers (immutable)', () => {
  it('addMonster appends new ids at count 1 and increments existing', () => {
    expect(addMonster(base, 'c')).toEqual([...base, { monsterId: 'c', count: 1 }]);
    expect(addMonster(base, 'a')).toEqual([{ monsterId: 'a', count: 3 }, { monsterId: 'b', count: 1 }]);
    expect(base[0].count).toBe(2); // untouched
  });

  it('setCount clamps at 1+ and removes at 0 or below', () => {
    expect(setCount(base, 'b', 4)).toEqual([{ monsterId: 'a', count: 2 }, { monsterId: 'b', count: 4 }]);
    expect(setCount(base, 'a', 0)).toEqual([{ monsterId: 'b', count: 1 }]);
    expect(setCount(base, 'missing', 3)).toEqual(base);
  });

  it('removeMonster drops the id; totalCount sums', () => {
    expect(removeMonster(base, 'a')).toEqual([{ monsterId: 'b', count: 1 }]);
    expect(totalCount(base)).toBe(3);
    expect(totalCount([])).toBe(0);
  });
});
