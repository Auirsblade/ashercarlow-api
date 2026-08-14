// apps/swdnd/src/lib/visibility.ts — spec §1 visibility matrix (client-side trust model, v1).
import { fogActive, isRevealed, toFogSet } from './fog';
import type { TokenDto } from './scenes';

export interface ViewerCtx {
  isDm: boolean;
  revealed: string[];
  ownCharacterIds: Set<string>;
  /** Ships this player crews; absent on legacy call sites. */
  ownShipIds?: Set<string>;
}

/** "Mine": my character's token, or a token bound to a ship I crew. */
export function isOwnToken(
  t: Pick<TokenDto, 'character_id' | 'ship_id'>,
  ctx: Pick<ViewerCtx, 'ownCharacterIds' | 'ownShipIds'>,
): boolean {
  if (t.character_id && ctx.ownCharacterIds.has(t.character_id)) return true;
  return !!t.ship_id && !!ctx.ownShipIds?.has(t.ship_id);
}

export function tokenVisibility(t: TokenDto, ctx: ViewerCtx): { visible: boolean; dimmed: boolean } {
  if (ctx.isDm) return { visible: true, dimmed: t.hidden === 1 };
  if (t.hidden === 1) return { visible: false, dimmed: false };
  if (fogActive(ctx.revealed)) {
    if (!isOwnToken(t, ctx) && !isRevealed(toFogSet(ctx.revealed), { q: t.q, r: t.r })) {
      return { visible: false, dimmed: false };
    }
  }
  return { visible: true, dimmed: false };
}

/** HP rings: DM sees all (hostiles included); players see friendly only. */
export const showHpRing = (t: TokenDto, isDm: boolean): boolean => isDm || t.faction === 'friendly';
