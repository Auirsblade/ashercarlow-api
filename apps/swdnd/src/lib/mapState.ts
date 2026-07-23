// apps/swdnd/src/lib/mapState.ts — pure reducers merging WS events + optimistic moves.
import type { WsEnvelope } from './ws';
import type { SceneDto, TokenDto } from './scenes';

export interface MapState {
  scene: SceneDto | null;
  tokens: Record<string, TokenDto>;
  /**
   * tokenId → in-flight optimistic move; token:updated echoes are held off
   * while an entry is set. `seq` increments per token on every optimistic
   * move so a confirm/rollback for a superseded move (e.g. two quick moves
   * on the same token) is a no-op rather than clobbering the newer one.
   */
  pendingMoves: Record<string, { q: number; r: number; seq: number }>;
  /** Remote drag previews, map-image pixel space. */
  dragGhosts: Record<string, { x: number; y: number }>;
  /** Set when the active scene changed server-side → the hook reloads. */
  staleScene: boolean;
}

export const emptyMapState = (): MapState => ({
  scene: null, tokens: {}, pendingMoves: {}, dragGhosts: {}, staleScene: false,
});

export function optimisticMove(
  s: MapState, tokenId: string, q: number, r: number,
): { state: MapState; seq: number } {
  const tok = s.tokens[tokenId];
  if (!tok) return { state: s, seq: s.pendingMoves[tokenId]?.seq ?? 0 };
  const seq = (s.pendingMoves[tokenId]?.seq ?? 0) + 1;
  return {
    state: {
      ...s,
      tokens: { ...s.tokens, [tokenId]: { ...tok, q, r } },
      pendingMoves: { ...s.pendingMoves, [tokenId]: { q, r, seq } },
    },
    seq,
  };
}

/** No-op if `seq` has since been superseded by a newer optimistic move on the same token. */
export function confirmMove(s: MapState, tokenId: string, seq: number): MapState {
  if (s.pendingMoves[tokenId]?.seq !== seq) return s;
  const { [tokenId]: _done, ...rest } = s.pendingMoves;
  return { ...s, pendingMoves: rest };
}

/** No-op (does not revert position or clear the guard) if `seq` has been superseded. */
export function rollbackMove(s: MapState, tokenId: string, seq: number, q: number, r: number): MapState {
  if (s.pendingMoves[tokenId]?.seq !== seq) return s;
  const tok = s.tokens[tokenId];
  const { [tokenId]: _done, ...rest } = s.pendingMoves;
  return {
    ...s,
    pendingMoves: rest,
    tokens: tok ? { ...s.tokens, [tokenId]: { ...tok, q, r } } : s.tokens,
  };
}

export function applyMapEvent(s: MapState, env: WsEnvelope): MapState {
  switch (env.type) {
    case 'token:created':
    case 'token:updated': {
      const tok = env.payload as TokenDto;
      if (env.type === 'token:updated' && s.pendingMoves[tok.id]) return s; // echo guard
      return { ...s, tokens: { ...s.tokens, [tok.id]: tok } };
    }
    case 'token:deleted': {
      const { id } = env.payload as { id: string };
      const { [id]: _gone, ...tokens } = s.tokens;
      const { [id]: _ghost, ...dragGhosts } = s.dragGhosts;
      return { ...s, tokens, dragGhosts };
    }
    case 'token:drag': {
      const { tokenId, x, y, done } = env.payload as { tokenId: string; x: number; y: number; done: boolean };
      if (done) {
        const { [tokenId]: _g, ...dragGhosts } = s.dragGhosts;
        return { ...s, dragGhosts };
      }
      return { ...s, dragGhosts: { ...s.dragGhosts, [tokenId]: { x, y } } };
    }
    case 'scene:updated': {
      const scene = env.payload as SceneDto;
      if (!s.scene || scene.id !== s.scene.id) return s;
      return { ...s, scene };
    }
    case 'scene:activated':
    case 'scene:deleted':
      return { ...s, staleScene: true };
    default:
      return s;
  }
}
