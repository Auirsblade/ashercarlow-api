// apps/swdnd/src/lib/encounters.test.ts
import { describe, expect, it } from 'bun:test';
import {
  addMonster, removeMonster, setCount, totalCount, type EncounterMonster,
  addStockShip, removeStockShip, setShipCount, totalShipCount, type EncounterShip,
} from './encounters';

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

describe('encounter ship helpers', () => {
  const list: EncounterShip[] = [
    { stockShipRef: 'tRnGAAILKowm8n4T', count: 2 },
    { stockShipRef: 'B5AmMDBTT6TrfW5E', count: 1 },
  ];

  it('adds a new ref at count 1 and increments a known one', () => {
    expect(addStockShip(list, 'zzz')).toEqual([...list, { stockShipRef: 'zzz', count: 1 }]);
    expect(addStockShip(list, 'B5AmMDBTT6TrfW5E')).toEqual([
      { stockShipRef: 'tRnGAAILKowm8n4T', count: 2 },
      { stockShipRef: 'B5AmMDBTT6TrfW5E', count: 2 },
    ]);
  });

  it('sets a count, dropping the entry at zero or below', () => {
    expect(setShipCount(list, 'tRnGAAILKowm8n4T', 5)[0].count).toBe(5);
    expect(setShipCount(list, 'tRnGAAILKowm8n4T', 0)).toEqual([{ stockShipRef: 'B5AmMDBTT6TrfW5E', count: 1 }]);
    expect(setShipCount(list, 'unknown', 4)).toBe(list);
  });

  it('removes and totals', () => {
    expect(removeStockShip(list, 'B5AmMDBTT6TrfW5E')).toEqual([{ stockShipRef: 'tRnGAAILKowm8n4T', count: 2 }]);
    expect(totalShipCount(list)).toBe(3);
    expect(totalShipCount([])).toBe(0);
  });

  it('never mutates the input', () => {
    const snapshot = JSON.stringify(list);
    addStockShip(list, 'zzz');
    setShipCount(list, 'tRnGAAILKowm8n4T', 9);
    removeStockShip(list, 'tRnGAAILKowm8n4T');
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});
