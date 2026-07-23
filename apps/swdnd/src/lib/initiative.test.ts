import { describe, expect, it } from 'bun:test';
import {
  entriesFromTokens, nextTurn, prevTurn, removeEntry, sortByRoll, startInitiative, type Initiative,
} from './initiative';

const init = (over: Partial<Initiative> = {}): Initiative => ({
  order: [
    { tokenId: 'a', name: 'A', roll: 18 },
    { tokenId: 'b', name: 'B', roll: 11 },
    { tokenId: 'c', name: 'C', roll: 5 },
  ],
  activeIndex: 0,
  round: 1,
  ...over,
});

describe('startInitiative / sortByRoll', () => {
  it('sorts descending by roll and starts at round 1, index 0', () => {
    const s = startInitiative([
      { tokenId: 'b', name: 'B', roll: 11 },
      { tokenId: 'a', name: 'A', roll: 18 },
    ]);
    expect(s.order.map((e) => e.tokenId)).toEqual(['a', 'b']);
    expect(s.activeIndex).toBe(0);
    expect(s.round).toBe(1);
  });
  it('sortByRoll does not mutate', () => {
    const arr = [{ tokenId: 'b', name: 'B', roll: 1 }, { tokenId: 'a', name: 'A', roll: 2 }];
    sortByRoll(arr);
    expect(arr[0].tokenId).toBe('b');
  });
});

describe('nextTurn / prevTurn', () => {
  it('advances and wraps with a round increment', () => {
    let s = init();
    s = nextTurn(s); expect(s.activeIndex).toBe(1);
    s = nextTurn(s); expect(s.activeIndex).toBe(2);
    s = nextTurn(s); expect(s).toMatchObject({ activeIndex: 0, round: 2 });
  });
  it('prevTurn wraps back a round but never below round 1', () => {
    let s = init({ activeIndex: 0, round: 2 });
    s = prevTurn(s); expect(s).toMatchObject({ activeIndex: 2, round: 1 });
    s = prevTurn(s); expect(s.activeIndex).toBe(1);
    const start = init(); // round 1, index 0
    expect(prevTurn(start)).toEqual(start);
  });
  it('no-ops on an empty order', () => {
    const empty = init({ order: [], activeIndex: 0 });
    expect(nextTurn(empty)).toEqual(empty);
    expect(prevTurn(empty)).toEqual(empty);
  });
});

describe('removeEntry', () => {
  it('removing before the active entry shifts activeIndex down', () => {
    const s = removeEntry(init({ activeIndex: 2 }), 'a');
    expect(s.order.map((e) => e.tokenId)).toEqual(['b', 'c']);
    expect(s.activeIndex).toBe(1); // still C's turn
  });
  it('removing the active last entry wraps activeIndex to 0', () => {
    const s = removeEntry(init({ activeIndex: 2 }), 'c');
    expect(s.activeIndex).toBe(0);
  });
  it('unknown token is a no-op', () => {
    expect(removeEntry(init(), 'zz')).toEqual(init());
  });
});

describe('entriesFromTokens', () => {
  it('maps non-hidden tokens to roll-0 entries', () => {
    const entries = entriesFromTokens([
      { id: 't1', name: 'Brakk', hidden: 0 },
      { id: 't2', name: 'Sneak', hidden: 1 },
    ]);
    expect(entries).toEqual([{ tokenId: 't1', name: 'Brakk', roll: 0 }]);
  });
});
