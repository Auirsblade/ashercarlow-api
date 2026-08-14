// apps/swdnd/src/lib/initiative.ts — pure initiative-tracker operations.
export interface InitiativeEntry {
  tokenId: string;
  name: string;
  roll: number;
  /** Ship entries nest their crew's token ids: one strip slot, many creatures. */
  crew?: string[];
}
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

/** Remove a token's entry (and any nested reference to it), keeping the same creature's turn active where possible. */
export function removeEntry(init: Initiative, tokenId: string): Initiative {
  const idx = init.order.findIndex((e) => e.tokenId === tokenId);
  const order = (idx === -1 ? init.order : init.order.filter((e) => e.tokenId !== tokenId))
    .map((e) => {
      if (!e.crew?.includes(tokenId)) return e;
      const crew = e.crew.filter((id) => id !== tokenId);
      const { crew: _dropped, ...rest } = e;
      return crew.length ? { ...rest, crew } : rest;
    });
  if (idx === -1) return order === init.order ? init : { ...init, order };
  let activeIndex = init.activeIndex;
  if (idx < activeIndex) activeIndex -= 1;
  if (activeIndex >= order.length) activeIndex = 0;
  return { ...init, order, activeIndex };
}

/** Seed entries from the scene's tokens (hidden tokens stay out of the public order). */
export const entriesFromTokens = (tokens: { id: string; name: string; hidden: number }[]): InitiativeEntry[] =>
  tokens.filter((t) => t.hidden !== 1).map((t) => ({ tokenId: t.id, name: t.name, roll: 0 }));

/**
 * Tolerant reader for `scene.initiative_json`: legacy entries (no `crew`),
 * partial fields, and out-of-range indices all parse rather than throw.
 */
export function parseInitiative(raw: unknown): Initiative | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { order?: unknown; activeIndex?: unknown; round?: unknown };
  if (!Array.isArray(o.order)) return null;
  const order: InitiativeEntry[] = [];
  for (const item of o.order) {
    if (!item || typeof item !== 'object') continue;
    const { tokenId, name, roll, crew } = item as Record<string, unknown>;
    if (typeof tokenId !== 'string' || !tokenId) continue;
    const entry: InitiativeEntry = {
      tokenId,
      name: typeof name === 'string' ? name : '',
      roll: typeof roll === 'number' && Number.isFinite(roll) ? roll : 0,
    };
    const ids = Array.isArray(crew) ? crew.filter((x): x is string => typeof x === 'string' && !!x) : [];
    if (ids.length) entry.crew = ids;
    order.push(entry);
  }
  const roundRaw = typeof o.round === 'number' && Number.isFinite(o.round) ? Math.floor(o.round) : 1;
  const idxRaw = typeof o.activeIndex === 'number' && Number.isFinite(o.activeIndex) ? Math.floor(o.activeIndex) : 0;
  return {
    order,
    activeIndex: order.length === 0 ? 0 : Math.min(Math.max(0, idxRaw), order.length - 1),
    round: Math.max(1, roundRaw),
  };
}

/**
 * Nest `crewTokenIds` under the ship's entry: one strip slot for the whole
 * crew. SOTG: the lowest crew roll sets the ship's place in the order (when
 * the ship already had crew, its current slot value is that running minimum).
 * The active creature keeps its turn — a nested crew member hands it to the ship.
 */
export function groupCrew(init: Initiative, shipTokenId: string, crewTokenIds: string[]): Initiative {
  const ship = init.order.find((e) => e.tokenId === shipTokenId);
  if (!ship) return init;
  const ids = new Set(crewTokenIds.filter((id) => id && id !== shipTokenId));
  const moved = init.order.filter((e) => ids.has(e.tokenId));
  if (moved.length === 0) return init;

  const activeId = init.order[init.activeIndex]?.tokenId ?? null;
  const rolls = moved.map((e) => e.roll);
  const hadCrew = (ship.crew ?? []).length > 0;
  const order = init.order
    .filter((e) => !ids.has(e.tokenId))
    .map((e) => (e.tokenId === shipTokenId
      ? {
          ...e,
          crew: [...(e.crew ?? []), ...moved.map((m) => m.tokenId)],
          roll: hadCrew ? Math.min(e.roll, ...rolls) : Math.min(...rolls),
        }
      : e));

  const keepId = activeId && ids.has(activeId) ? shipTokenId : activeId;
  const found = keepId ? order.findIndex((e) => e.tokenId === keepId) : -1;
  return { ...init, order, activeIndex: found === -1 ? 0 : found };
}

/** Re-promote a ship's crew to top-level entries, right after the ship, at the slot's roll. */
export function ungroupCrew(
  init: Initiative,
  shipTokenId: string,
  nameFor: (tokenId: string) => string,
): Initiative {
  const idx = init.order.findIndex((e) => e.tokenId === shipTokenId);
  if (idx === -1 || !init.order[idx].crew?.length) return init;
  const ship = init.order[idx];
  const { crew = [], ...bare } = ship;
  const restored: InitiativeEntry[] = crew.map((tokenId) => ({ tokenId, name: nameFor(tokenId), roll: ship.roll }));
  const order = [...init.order.slice(0, idx), bare, ...restored, ...init.order.slice(idx + 1)];
  const activeId = init.order[init.activeIndex]?.tokenId ?? null;
  const found = activeId ? order.findIndex((e) => e.tokenId === activeId) : -1;
  return { ...init, order, activeIndex: found === -1 ? 0 : found };
}
