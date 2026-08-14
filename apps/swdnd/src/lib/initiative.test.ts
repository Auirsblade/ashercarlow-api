import { describe, expect, it } from 'bun:test';
import {
  entriesFromTokens, groupCrew, nextTurn, parseInitiative, prevTurn, removeEntry, sortByRoll, startInitiative,
  ungroupCrew, type Initiative,
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

describe('parseInitiative', () => {
  it('accepts legacy documents with no crew key', () => {
    const parsed = parseInitiative({ order: [{ tokenId: 'a', name: 'A', roll: 12 }], activeIndex: 0, round: 3 });
    expect(parsed).toEqual({ order: [{ tokenId: 'a', name: 'A', roll: 12 }], activeIndex: 0, round: 3 });
  });

  it('keeps crew arrays and drops junk members', () => {
    const parsed = parseInitiative({ order: [{ tokenId: 'ship', name: 'Krayt', roll: 9, crew: ['c1', 7, '', 'c2'] }], activeIndex: 0, round: 1 });
    expect(parsed!.order[0].crew).toEqual(['c1', 'c2']);
  });

  it('drops malformed entries and defaults missing fields', () => {
    const parsed = parseInitiative({ order: [null, { name: 'no id' }, { tokenId: 'a' }], activeIndex: 9, round: 0 });
    expect(parsed).toEqual({ order: [{ tokenId: 'a', name: '', roll: 0 }], activeIndex: 0, round: 1 });
  });

  it('clamps activeIndex into range and returns null for non-documents', () => {
    const parsed = parseInitiative({ order: [{ tokenId: 'a', name: 'A', roll: 1 }, { tokenId: 'b', name: 'B', roll: 2 }], activeIndex: 5, round: 2 });
    expect(parsed!.activeIndex).toBe(1);
    expect(parseInitiative(null)).toBeNull();
    expect(parseInitiative({ order: 'nope' })).toBeNull();
    expect(parseInitiative('{}')).toBeNull();
  });

  it('dedupes crew ids and drops self-references', () => {
    const parsed = parseInitiative({
      order: [{ tokenId: 'ship', name: 'Krayt', roll: 9, crew: ['pilot', 'pilot', 'ship', 'gunner'] }],
      activeIndex: 0, round: 1,
    });
    expect(parsed!.order[0].crew).toEqual(['pilot', 'gunner']);
  });
});

describe('groupCrew', () => {
  const base = () => ({
    order: [
      { tokenId: 'ship', name: 'Krayt', roll: 20 },
      { tokenId: 'pilot', name: 'Pilot', roll: 14 },
      { tokenId: 'gunner', name: 'Gunner', roll: 9 },
      { tokenId: 'droid', name: 'Droid', roll: 4 },
    ],
    activeIndex: 0,
    round: 1,
  });

  it('nests crew under the ship and takes the lowest crew roll as the slot', () => {
    const next = groupCrew(base(), 'ship', ['pilot', 'gunner']);
    expect(next.order.map((e) => e.tokenId)).toEqual(['ship', 'droid']);
    expect(next.order[0].crew).toEqual(['pilot', 'gunner']);
    expect(next.order[0].roll).toBe(9);
  });

  it('a second grouping keeps the running minimum', () => {
    const once = groupCrew(base(), 'ship', ['gunner']);
    expect(once.order[0].roll).toBe(9);
    const twice = groupCrew(once, 'ship', ['pilot']);
    expect(twice.order[0].roll).toBe(9);
    expect(twice.order[0].crew).toEqual(['gunner', 'pilot']);
  });

  it('keeps the same combatant active across the reshuffle', () => {
    const init = { ...base(), activeIndex: 3 }; // droid
    const next = groupCrew(init, 'ship', ['pilot', 'gunner']);
    expect(next.order[next.activeIndex].tokenId).toBe('droid');
  });

  it('an active crew member hands the turn to its ship slot', () => {
    const init = { ...base(), activeIndex: 1 }; // pilot
    const next = groupCrew(init, 'ship', ['pilot']);
    expect(next.order[next.activeIndex].tokenId).toBe('ship');
  });

  it('is a no-op for an unknown ship, an empty list, or self-grouping', () => {
    const init = base();
    expect(groupCrew(init, 'nope', ['pilot'])).toBe(init);
    expect(groupCrew(init, 'ship', [])).toBe(init);
    expect(groupCrew(init, 'ship', ['ship'])).toBe(init);
  });

  it('dedupes crew when re-grouping an id that is already nested', () => {
    // Malformed/hand-edited doc: 'pilot' is both nested under the ship AND still a top-level entry.
    const malformed = {
      order: [
        { tokenId: 'ship', name: 'Krayt', roll: 20, crew: ['pilot'] },
        { tokenId: 'pilot', name: 'Pilot', roll: 14 },
      ],
      activeIndex: 0,
      round: 1,
    };
    const grouped = groupCrew(malformed, 'ship', ['pilot']);
    expect(grouped.order[0].crew).toEqual(['pilot']);
    const back = ungroupCrew(grouped, 'ship', () => 'Pilot');
    expect(back.order.map((e) => e.tokenId)).toEqual(['ship', 'pilot']);
  });
});

describe('ungroupCrew', () => {
  it('re-promotes crew right after the ship, carrying the slot roll', () => {
    const grouped = groupCrew(
      { order: [{ tokenId: 'ship', name: 'Krayt', roll: 20 }, { tokenId: 'pilot', name: 'Pilot', roll: 14 }, { tokenId: 'z', name: 'Z', roll: 1 }], activeIndex: 0, round: 1 },
      'ship', ['pilot'],
    );
    const back = ungroupCrew(grouped, 'ship', (id) => (id === 'pilot' ? 'Pilot' : id));
    expect(back.order.map((e) => e.tokenId)).toEqual(['ship', 'pilot', 'z']);
    expect(back.order[1]).toEqual({ tokenId: 'pilot', name: 'Pilot', roll: 14 });
    expect(back.order[0].crew).toBeUndefined();
  });

  it('is a no-op when the ship has no crew', () => {
    const init = { order: [{ tokenId: 'ship', name: 'Krayt', roll: 20 }], activeIndex: 0, round: 1 };
    expect(ungroupCrew(init, 'ship', () => 'x')).toBe(init);
  });

  it('a two-crew round-trip returns both crew at the absorbed minimum roll (documented lossy behavior)', () => {
    const grouped = groupCrew(
      {
        order: [
          { tokenId: 'ship', name: 'Krayt', roll: 20 },
          { tokenId: 'pilot', name: 'Pilot', roll: 14 },
          { tokenId: 'gunner', name: 'Gunner', roll: 9 },
        ],
        activeIndex: 0,
        round: 1,
      },
      'ship', ['pilot', 'gunner'],
    );
    const back = ungroupCrew(grouped, 'ship', (id) => (id === 'pilot' ? 'Pilot' : 'Gunner'));
    expect(back.order.map((e) => e.tokenId)).toEqual(['ship', 'pilot', 'gunner']);
    // Both crew come back at the absorbed minimum (9), not their original individual rolls (14, 9) — the
    // per-crew roll is lost once grouped, distinct from the single-crew case where min === that one roll.
    expect(back.order[1].roll).toBe(9);
    expect(back.order[2].roll).toBe(9);
  });
});

describe('removeEntry with crew', () => {
  it('strips a removed token out of crew arrays too', () => {
    const init = { order: [{ tokenId: 'ship', name: 'Krayt', roll: 9, crew: ['pilot', 'gunner'] }], activeIndex: 0, round: 1 };
    const next = removeEntry(init, 'gunner');
    expect(next.order[0].crew).toEqual(['pilot']);
  });

  it('removing the ship removes its whole slot', () => {
    const init = { order: [{ tokenId: 'ship', name: 'Krayt', roll: 9, crew: ['pilot'] }, { tokenId: 'z', name: 'Z', roll: 1 }], activeIndex: 0, round: 1 };
    expect(removeEntry(init, 'ship').order.map((e) => e.tokenId)).toEqual(['z']);
  });
});
