// apps/swdnd/src/hooks/useTabletop.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { connectCampaign, type CampaignSocket, type WsEnvelope } from '../lib/ws';
import {
  activateScene, createScene, createToken, deleteScene, deleteToken, listScenes,
  listTokens, moveToken, patchFog, patchScene, patchToken, uploadSceneImage, type SceneDto, type TokenDto,
} from '../lib/scenes';
import {
  applyMapEvent, confirmMove, emptyMapState, optimisticMove, rollbackMove, type MapState,
} from '../lib/mapState';
import { buildVitals, mergePlay, type Vitals } from '../lib/vitals';
import type { GridConfig } from '../lib/hex';

export interface TabletopState {
  loading: boolean;
  error: string | null;
  scene: SceneDto | null;
  scenes: SceneDto[];           // full list (scene drawer)
  tokens: TokenDto[];
  dragGhosts: Record<string, { x: number; y: number }>;
  isDm: boolean;
  playerToken: string | null;
  canMove: (t: TokenDto) => boolean;
  ownCharacterIds: Set<string>;
  vitals: Record<string, Vitals>;
  actions: {
    move: (tokenId: string, q: number, r: number) => void;
    sendDrag: (tokenId: string, x: number, y: number, done: boolean) => void;
    createScene: (name: string) => Promise<SceneDto>;
    renameScene: (id: string, name: string) => Promise<void>;
    setGrid: (id: string, grid: GridConfig) => Promise<void>;
    upload: (id: string, file: File, w: number, h: number) => Promise<void>;
    activate: (id: string) => Promise<void>;
    removeScene: (id: string) => Promise<void>;
    addToken: (body: Partial<TokenDto> & { name: string }) => Promise<void>;
    removeToken: (id: string) => Promise<void>;
    editToken: (id: string, body: Record<string, unknown>) => Promise<void>;
    commitFog: (reveal: string[], hide: string[]) => Promise<void>;
    reload: () => void;
  };
}

const DRAG_THROTTLE_MS = 80;

export function useTabletop(campaignId: string): TabletopState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const playerToken = searchParams.get('token');

  const [state, setState] = useState<MapState>(emptyMapState());
  const [scenes, setScenes] = useState<SceneDto[]>([]);
  const [ownCharacterIds, setOwnCharacterIds] = useState<Set<string>>(new Set());
  const [vitals, setVitals] = useState<Record<string, Vitals>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<CampaignSocket | null>(null);
  const lastDrag = useRef(0);
  const room = `campaign:${campaignId}`;

  const reload = useCallback(() => {
    setLoading(true);
    listScenes(campaignId)
      .then(async (all) => {
        setScenes(all);
        const active = all.find((s) => s.is_active === 1) ?? null;
        const tokens = active ? await listTokens(active.id) : [];
        setState((prev) => ({
          ...emptyMapState(),
          scene: active,
          tokens: Object.fromEntries(tokens.map((t) => [t.id, t])),
          dragGhosts: prev.dragGhosts,
        }));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [campaignId]);

  useEffect(reload, [reload]);

  // Which characters belong to this player link (players/me), for canMove.
  useEffect(() => {
    if (!playerToken) return;
    import('../lib/characters').then(({ getPlayerByToken }) =>
      getPlayerByToken(playerToken)
        .then((me) => setOwnCharacterIds(new Set(me.characters.map((c) => c.id))))
        .catch(() => setOwnCharacterIds(new Set())),
    );
  }, [playerToken]);

  // Load campaign characters + reference once and compute each character's
  // maxHp; play.hp/conditions then track character:updated events live.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import('../lib/characters').then((m) => m.listCharacters(campaignId)),
      import('../lib/characters').then((m) => m.loadReference()),
    ])
      .then(([chars, ref]) => { if (!cancelled) setVitals(buildVitals(chars, ref)); })
      .catch(() => { /* vitals stay empty; rings for character tokens simply don't render */ });
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    const hadOpenedRef = { current: false };
    const sock = connectCampaign(campaignId, (env: WsEnvelope) => {
      if (env.type === 'character:updated') {
        const p = env.payload as { characterId?: string; play?: { hp: number; conditions: string[] } };
        if (p?.characterId && p.play) setVitals((v) => mergePlay(v, p.characterId!, p.play!));
        return;
      }
      setState((s) => applyMapEvent(s, env));
    }, (open) => {
      // Events that arrive during a dropped-connection gap are lost; resync
      // the whole snapshot on every reconnect after the initial open (the
      // initial load already fetches state, so skip reloading for it).
      if (open) {
        if (hadOpenedRef.current) reload();
        hadOpenedRef.current = true;
      }
    }, playerToken);
    socket.current = sock;
    return () => sock.close();
  }, [campaignId, playerToken, reload]);

  // scene:activated / scene:deleted → refetch the whole snapshot.
  useEffect(() => {
    if (state.staleScene) reload();
  }, [state.staleScene, reload]);

  const move = useCallback((tokenId: string, q: number, r: number) => {
    let prev: { q: number; r: number } | null = null;
    let seq = 0;
    setState((s) => {
      prev = s.tokens[tokenId] ? { q: s.tokens[tokenId].q, r: s.tokens[tokenId].r } : null;
      const result = optimisticMove(s, tokenId, q, r);
      seq = result.seq;
      return result.state;
    });
    moveToken(tokenId, q, r, playerToken)
      .then(() => setState((s) => confirmMove(s, tokenId, seq)))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Move failed');
        setState((s) => (prev ? rollbackMove(s, tokenId, seq, prev.q, prev.r) : confirmMove(s, tokenId, seq)));
      });
  }, [playerToken]);

  const sendDrag = useCallback((tokenId: string, x: number, y: number, done: boolean) => {
    const now = Date.now();
    if (!done && now - lastDrag.current < DRAG_THROTTLE_MS) return;
    lastDrag.current = now;
    socket.current?.send({ type: 'token:drag', room, payload: { tokenId, x, y, done } });
  }, [room]);

  const wrap = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    async (...a: A) => { try { await fn(...a); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } };

  return {
    loading,
    error,
    scene: state.scene,
    scenes,
    tokens: Object.values(state.tokens),
    dragGhosts: state.dragGhosts,
    isDm: authed,
    playerToken,
    ownCharacterIds,
    vitals,
    canMove: (t) => authed || (!!t.character_id && ownCharacterIds.has(t.character_id)),
    actions: {
      move,
      sendDrag,
      createScene: async (name) => { const s = await createScene(campaignId, name); reload(); return s; },
      renameScene: wrap(async (id: string, name: string) => { await patchScene(id, { name }); reload(); }),
      setGrid: wrap(async (id: string, grid: GridConfig) => { await patchScene(id, { grid }); }),
      upload: wrap(async (id: string, file: File, w: number, h: number) => { await uploadSceneImage(id, file, w, h); reload(); }),
      activate: wrap(async (id: string) => { await activateScene(id); }),
      removeScene: wrap(async (id: string) => { await deleteScene(id); reload(); }),
      addToken: wrap(async (body: Partial<TokenDto> & { name: string }) => { if (state.scene) await createToken(state.scene.id, body); }),
      removeToken: wrap(async (id: string) => { await deleteToken(id); }),
      editToken: wrap(async (id: string, body: Record<string, unknown>) => { await patchToken(id, body); }),
      commitFog: wrap(async (reveal: string[], hide: string[]) => {
        if (state.scene) await patchFog(state.scene.id, reveal, hide);
      }),
      reload,
    },
  };
}
