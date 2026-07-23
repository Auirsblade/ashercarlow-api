// apps/swdnd/src/lib/initiative.ts — pure initiative-tracker operations.
export interface InitiativeEntry { tokenId: string; name: string; roll: number }
export interface Initiative { order: InitiativeEntry[]; activeIndex: number; round: number }

export const sortByRoll = (entries: InitiativeEntry[]): InitiativeEntry[] =>
  [...entries].sort((a, b) => b.roll - a.roll);

export const startInitiative = (entries: InitiativeEntry[]): Initiative =>
  ({ order: sortByRoll(entries), activeIndex: 0, round: 1 });

export function nextTurn(init: Initiative): Initiative {
  const n = init.order.length;
  if (n === 0) return init;
  const i = init.activeIndex + 1;
  return i >= n ? { ...init, activeIndex: 0, round: init.round + 1 } : { ...init, activeIndex: i };
}

export function prevTurn(init: Initiative): Initiative {
  const n = init.order.length;
  if (n === 0) return init;
  if (init.activeIndex === 0) {
    return init.round > 1 ? { ...init, activeIndex: n - 1, round: init.round - 1 } : init;
  }
  return { ...init, activeIndex: init.activeIndex - 1 };
}

/** Remove a token's entry, keeping the same creature's turn active where possible. */
export function removeEntry(init: Initiative, tokenId: string): Initiative {
  const idx = init.order.findIndex((e) => e.tokenId === tokenId);
  if (idx === -1) return init;
  const order = init.order.filter((e) => e.tokenId !== tokenId);
  let activeIndex = init.activeIndex;
  if (idx < activeIndex) activeIndex -= 1;
  if (activeIndex >= order.length) activeIndex = 0;
  return { ...init, order, activeIndex };
}

/** Seed entries from the scene's tokens (hidden tokens stay out of the public order). */
export const entriesFromTokens = (tokens: { id: string; name: string; hidden: number }[]): InitiativeEntry[] =>
  tokens.filter((t) => t.hidden !== 1).map((t) => ({ tokenId: t.id, name: t.name, roll: 0 }));
