// apps/swdnd/src/hooks/useTabletop.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { connectCampaign, type CampaignSocket, type WsEnvelope } from '../lib/ws';
import {
  activateScene, clearTemplates, createScene, createTemplate, createToken, deleteScene, deleteTemplate,
  deleteToken, deleteTokenImage, listScenes, listTemplates, listTokens, moveToken, patchFog, patchInitiative,
  patchScene, patchToken, uploadSceneImage, uploadTokenImage, type SceneDto, type TemplateDto, type TokenDto,
} from '../lib/scenes';
import {
  applyMapEvent, confirmMove, emptyMapState, optimisticMove, rollbackMove, type MapState,
} from '../lib/mapState';
import { applyFogPatch } from '../lib/fog';
import { addCharacterVitals, applyPendingPlays, buildVitals, mergePlay, type PendingPlays, type Vitals } from '../lib/vitals';
import type { GridConfig, Hex } from '../lib/hex';
import type { Initiative } from '../lib/initiative';
import type { ReferenceData } from '../lib/rules/types';

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
  ownCharacters: { id: string; name: string }[];
  vitals: Record<string, Vitals>;
  templates: TemplateDto[];
  pings: { id: string; x: number; y: number }[];
  rulers: Record<string, { a: Hex; b: Hex }>;   // peer id → live remote ruler
  initiative: Initiative | null;                 // parsed from scene.initiative_json
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
    setTokenImage: (id: string, file: File) => Promise<void>;
    clearTokenImage: (id: string) => Promise<void>;
    commitFog: (reveal: string[], hide: string[]) => Promise<void>;
    addTemplate: (body: Record<string, unknown>) => Promise<void>;
    removeTemplate: (id: string) => Promise<void>;
    clearAllTemplates: () => Promise<void>;
    sendPing: (x: number, y: number) => void;
    sendRuler: (a: Hex, b: Hex, done: boolean) => void;
    setInitiative: (init: Initiative | null) => Promise<void>;
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
  const [ownCharacters, setOwnCharacters] = useState<{ id: string; name: string }[]>([]);
  const [vitals, setVitals] = useState<Record<string, Vitals>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<CampaignSocket | null>(null);
  const lastDrag = useRef(0);
  const refData = useRef<ReferenceData | null>(null);
  const vitalsLoaded = useRef(false);
  const pendingPlays = useRef<PendingPlays>({});
  const room = `campaign:${campaignId}`;

  const peerId = useRef<string>(crypto.randomUUID());
  const pingSeq = useRef(0);
  const [pings, setPings] = useState<{ id: string; x: number; y: number; at: number }[]>([]);
  const [rulers, setRulers] = useState<Record<string, { a: Hex; b: Hex; at: number }>>({});
  const lastRuler = useRef(0);

  const reload = useCallback(() => {
    setLoading(true);
    setRulers({});
    setPings([]);
    listScenes(campaignId)
      .then(async (all) => {
        setScenes(all);
        const active = all.find((s) => s.is_active === 1) ?? null;
        const [tokens, templates] = active
          ? await Promise.all([listTokens(active.id), listTemplates(active.id)])
          : [[], []];
        setState((prev) => ({
          ...emptyMapState(),
          scene: active,
          tokens: Object.fromEntries(tokens.map((t) => [t.id, t])),
          templates: Object.fromEntries(templates.map((t) => [t.id, t])),
          dragGhosts: prev.dragGhosts,
        }));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [campaignId]);

  // Prune pings ~2s after they land (rendered as short-lived pulses), and
  // drop remote ruler entries that have gone stale (~5s) — a peer that
  // disconnects mid-drag never sends the `done:true` frame that would
  // otherwise clear its ruler, so it would linger forever. Active drags
  // refresh `at` on every throttled frame (80ms), well under the cutoff.
  const hasRulers = Object.keys(rulers).length > 0;
  useEffect(() => {
    if (pings.length === 0 && !hasRulers) return;
    const t = setInterval(() => {
      const cutoff = Date.now() - 2200;
      setPings((p) => (p.some((x) => x.at < cutoff) ? p.filter((x) => x.at >= cutoff) : p));
      const rulerCutoff = Date.now() - 5000;
      setRulers((cur) => {
        const stale = Object.entries(cur).filter(([, v]) => v.at < rulerCutoff).map(([k]) => k);
        if (stale.length === 0) return cur;
        const next = { ...cur };
        for (const k of stale) delete next[k];
        return next;
      });
    }, 500);
    return () => clearInterval(t);
  }, [pings.length > 0, hasRulers]);

  useEffect(reload, [reload]);

  // Which characters belong to this player link (players/me), for canMove and sheet links.
  useEffect(() => {
    if (!playerToken) return;
    import('../lib/characters').then(({ getPlayerByToken }) =>
      getPlayerByToken(playerToken)
        .then((me) => {
          setOwnCharacterIds(new Set(me.characters.map((c) => c.id)));
          setOwnCharacters(me.characters.map((c) => ({ id: c.id, name: c.name })));
        })
        .catch(() => {
          setOwnCharacterIds(new Set());
          setOwnCharacters([]);
        }),
    );
  }, [playerToken]);

  // Load campaign characters + reference once and compute each character's
  // maxHp; play.hp/conditions then track character:updated events live.
  useEffect(() => {
    let cancelled = false;
    vitalsLoaded.current = false;
    pendingPlays.current = {};
    Promise.all([
      import('../lib/characters').then((m) => m.listCharacters(campaignId)),
      import('../lib/characters').then((m) => m.loadReference()),
    ])
      .then(([chars, ref]) => {
        if (cancelled) return;
        refData.current = ref;
        vitalsLoaded.current = true;
        setVitals(applyPendingPlays(buildVitals(chars, ref), pendingPlays.current));
        pendingPlays.current = {};
      })
      .catch(() => { /* vitals stay empty; rings for character tokens simply don't render */ });
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    const hadOpenedRef = { current: false };
    const sock = connectCampaign(campaignId, (env: WsEnvelope) => {
      if (env.type === 'character:updated') {
        const p = env.payload as { characterId?: string; play?: { hp: number; conditions: string[] } };
        const id = p?.characterId;
        const play = p?.play;
        if (!id || !play) return;
        if (!vitalsLoaded.current) {
          // Loader hasn't resolved yet; buffer so the eventual buildVitals() doesn't
          // clobber this update with a stale snapshot.
          pendingPlays.current[id] = play;
          return;
        }
        setVitals((v) => {
          if (v[id]) return mergePlay(v, id, play);
          // Unknown id: character created after load. Fetch its full DTO and adopt
          // it into the map; leave state untouched until that resolves.
          const ref = refData.current;
          if (ref) {
            import('../lib/characters')
              .then((m) => m.getCharacter(id))
              .then((character) => {
                const r = refData.current;
                if (!r) return;
                setVitals((v2) => mergePlay(addCharacterVitals(v2, character, r), id, play));
              })
              .catch(() => { /* character not found (e.g. deleted); stay a silent no-op */ });
          }
          return v;
        });
        return;
      }
      if (env.type === 'ping') {
        const p = env.payload as { id: string; x: number; y: number };
        setPings((cur) => [...cur, { ...p, at: Date.now() }]);
        return;
      }
      if (env.type === 'ruler') {
        const p = env.payload as { peer: string; a: Hex; b: Hex; done: boolean };
        setRulers((cur) => {
          if (p.done) {
            const { [p.peer]: _gone, ...rest } = cur;
            return rest;
          }
          return { ...cur, [p.peer]: { a: p.a, b: p.b, at: Date.now() } };
        });
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

  const sendPing = useCallback((x: number, y: number) => {
    const id = `${peerId.current}:${pingSeq.current++}`;
    setPings((cur) => [...cur, { id, x, y, at: Date.now() }]);
    socket.current?.send({ type: 'ping', room, payload: { id, x, y } });
  }, [room]);

  const sendRuler = useCallback((a: Hex, b: Hex, done: boolean) => {
    const now = Date.now();
    if (!done && now - lastRuler.current < DRAG_THROTTLE_MS) return;
    lastRuler.current = now;
    socket.current?.send({ type: 'ruler', room, payload: { peer: peerId.current, a, b, done } });
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
    ownCharacters,
    vitals,
    templates: Object.values(state.templates),
    pings,
    rulers: Object.fromEntries(Object.entries(rulers).map(([k, { a, b }]) => [k, { a, b }])),
    initiative: (state.scene?.initiative_json as Initiative | null) ?? null,
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
      setTokenImage: wrap(async (id: string, file: File) => { await uploadTokenImage(id, file, playerToken); }),
      clearTokenImage: wrap(async (id: string) => { await deleteTokenImage(id, playerToken); }),
      commitFog: async (reveal: string[], hide: string[]) => {
        const scene = state.scene;
        if (!scene) return;
        // Apply the patch locally first so painted fog doesn't flicker back
        // to its pre-stroke state for the round-trip window before the
        // scene:updated echo arrives — the echo then overwrites with the
        // identical server result (applyFogPatch is idempotent).
        setState((s) => (s.scene
          ? { ...s, scene: { ...s.scene, fog_json: applyFogPatch(s.scene.fog_json, { reveal, hide }) } }
          : s));
        try {
          await patchFog(scene.id, reveal, hide);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Fog update failed');
          reload(); // resync fog from the server since the optimistic patch may not have landed
        }
      },
      addTemplate: wrap(async (body: Record<string, unknown>) => {
        if (state.scene) await createTemplate(state.scene.id, body, playerToken);
      }),
      removeTemplate: wrap(async (id: string) => { await deleteTemplate(id, playerToken); }),
      clearAllTemplates: wrap(async () => { if (state.scene) await clearTemplates(state.scene.id); }),
      sendPing,
      sendRuler,
      setInitiative: async (init: Initiative | null) => {
        // Optimistic like commitFog: the strip must respond instantly to next/prev.
        setState((s) => (s.scene ? { ...s, scene: { ...s.scene, initiative_json: init } } : s));
        try {
          if (state.scene) await patchInitiative(state.scene.id, init);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Initiative update failed');
          reload();
        }
      },
      reload,
    },
  };
}
