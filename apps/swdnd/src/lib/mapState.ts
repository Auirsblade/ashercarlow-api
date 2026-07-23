// apps/swdnd/src/lib/mapState.ts — pure reducers merging WS events + optimistic moves.
import type { WsEnvelope } from './ws';
import type { SceneDto, TokenDto } from './scenes';

export interface MapState {
  scene: SceneDto | null;
  tokens: Record<string, TokenDto>;
  /** tokenId → in-flight optimistic move; token:updated echoes are held off while set. */
  pendingMoves: Record<string, { q: number; r: number }>;
  /** Remote drag previews, map-image pixel space. */
  dragGhosts: Record<string, { x: number; y: number }>;
  /** Set when the active scene changed server-side → the hook reloads. */
  staleScene: boolean;
}

export const emptyMapState = (): MapState => ({
  scene: null, tokens: {}, pendingMoves: {}, dragGhosts: {}, staleScene: false,
});

export function optimisticMove(s: MapState, tokenId: string, q: number, r: number): MapState {
  const tok = s.tokens[tokenId];
  if (!tok) return s;
  return {
    ...s,
    tokens: { ...s.tokens, [tokenId]: { ...tok, q, r } },
    pendingMoves: { ...s.pendingMoves, [tokenId]: { q, r } },
  };
}

export function confirmMove(s: MapState, tokenId: string): MapState {
  const { [tokenId]: _done, ...rest } = s.pendingMoves;
  return { ...s, pendingMoves: rest };
}

export function rollbackMove(s: MapState, tokenId: string, q: number, r: number): MapState {
  const tok = s.tokens[tokenId];
  return {
    ...confirmMove(s, tokenId),
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
