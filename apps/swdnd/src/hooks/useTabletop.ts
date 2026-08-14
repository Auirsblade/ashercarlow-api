// apps/swdnd/src/hooks/useTabletop.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { connectCampaign, type CampaignSocket, type WsEnvelope } from '../lib/ws';
import {
  activateScene, clearTemplates, createScene, createTemplate, createToken, deleteScene, deleteTemplate,
  deleteToken, deleteTokenImage, listScenes, listTemplates, listTokens, moveToken, patchFog, patchInitiative,
  patchScene, patchTemplate, patchToken, rotateToken, uploadSceneImage, uploadTokenImage,
  type SceneDto, type TemplateDto, type TokenDto,
} from '../lib/scenes';
import {
  applyMapEvent, confirmMove, emptyMapState, optimisticMove, rollbackMove, type MapState,
} from '../lib/mapState';
import { applyFogPatch } from '../lib/fog';
import { addCharacterVitals, applyPendingPlays, buildVitals, mergePlay, type PendingPlays, type Vitals } from '../lib/vitals';
import { spawnPositions } from '../lib/spawn';
import { hexKey } from '../lib/hex';
import { shipTokenScale } from '../lib/shipTokens';
import {
  addShipVitals, applyPendingShipPlays, buildShipVitals, crewedShipIds, mergeShipPlay,
  type PendingShipPlays, type ShipPlayLike, type ShipVitals,
} from '../lib/shipVitals';
import { parseInitiative, type Initiative } from '../lib/initiative';
import type { GridConfig, Hex } from '../lib/hex';
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
  shipVitals: Record<string, ShipVitals>;
  ownShipIds: Set<string>;
  /**
   * Campaign ships for the spawner: `list` is the roster (each with the token
   * scale its footprint implies), `loading` is true while a fetch is in
   * flight, and `spawning` holds the ids currently mid-spawn-request so the
   * spawner can disable that ship's button (T10 review, Findings 2 & 3).
   */
  ships: {
    list: { id: string; name: string; scale: number }[];
    loading: boolean;
    spawning: Set<string>;
  };
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
    setSceneMode: (id: string, mode: 'ground' | 'space') => Promise<void>;
    rotate: (tokenId: string, facing: number) => Promise<void>;
    setShipPlay: (shipId: string, edit: (doc: any) => any) => Promise<void>;
    spawnShip: (shipId: string) => Promise<void>;
    loadShips: () => void;
    setTokenImage: (id: string, file: File) => Promise<void>;
    clearTokenImage: (id: string) => Promise<void>;
    commitFog: (reveal: string[], hide: string[]) => Promise<void>;
    addTemplate: (body: Record<string, unknown>) => Promise<void>;
    editTemplate: (id: string, body: Record<string, unknown>) => Promise<void>;
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
  const [shipVitals, setShipVitals] = useState<Record<string, ShipVitals>>({});
  const [ships, setShips] = useState<{ id: string; name: string; scale: number }[]>([]);
  // Bumped by actions.loadShips() so the ship-load effect below re-runs even
  // when needShips was already true (e.g. re-clicking after a failed load) —
  // a boolean latch couldn't do this: re-clicking left it at the same value,
  // so the effect's deps never changed (T10 review, Finding 1).
  const [shipLoadNonce, setShipLoadNonce] = useState(0);
  // True only while the ship-load effect has a genuine fetch in flight, so
  // ShipSpawner can tell "still loading" apart from "loaded and empty"
  // (T10 review, Finding 2).
  const [shipsLoading, setShipsLoading] = useState(false);
  /** Full ship documents, needed to build whole-document PATCHes. */
  const shipDocs = useRef<Record<string, any>>({});
  const shipMaxima = useRef<(ship: any) => { maxHull: number; maxShields: number }>(() => ({ maxHull: 0, maxShields: 0 }));
  const shipsLoadedFor = useRef<string | null>(null);
  const pendingShipPlays = useRef<PendingShipPlays>({});
  // Bumped on every campaign switch; loadShips() captures it at call time and
  // checks it again once its fetches resolve, so a load kicked off for campaign
  // A can never land its writes after B has taken over (T8 review, Finding 1).
  const shipLoadSeq = useRef(0);
  // Per-ship in-flight setShipPlay PATCH count, so a ship:updated echo can tell
  // a stale re-base apart from a fresh one and leave local optimistic play alone
  // while more PATCHes for that ship are still in flight (T8 review, Finding 2).
  const pendingShipPatch = useRef<Record<string, number>>({});
  // Per-ship spawn-in-flight guard. A ref (mutated synchronously, not via
  // setState) so a second click landing before React re-renders still sees
  // the first click's write — spawnShip closes over render-time state, and
  // two clicks racing inside the token:created round-trip used to both
  // compute the same open hex and stack two tokens (T10 review, Finding 3).
  // spawningShipIds mirrors it in state purely so ShipSpawner can disable
  // the button; spawningShips.current is the mutation source of truth.
  const spawningShips = useRef<Set<string>>(new Set());
  const [spawningShipIds, setSpawningShipIds] = useState<Set<string>>(new Set());
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
    let alive = true;
    import('../lib/characters').then(({ getPlayerByToken }) =>
      getPlayerByToken(playerToken)
        .then((me) => {
          if (!alive) return;
          setOwnCharacterIds(new Set(me.characters.map((c) => c.id)));
          setOwnCharacters(me.characters.map((c) => ({ id: c.id, name: c.name })));
        })
        .catch(() => {
          if (!alive) return;
          setOwnCharacterIds(new Set());
          setOwnCharacters([]);
        }),
    );
    return () => { alive = false; };
  }, [playerToken]);

  // Ships this player crews (own-character ids resolved above, per shipDocs
  // loaded so far) — kept in state so canMove and the canvas (T9) both see it.
  const [ownShipIds, setOwnShipIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const docs = Object.values(shipDocs.current) as { id: string; crew?: { character_id: string }[] }[];
    setOwnShipIds(crewedShipIds(docs, ownCharacterIds));
  }, [ships, ownCharacterIds]);

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

  // Ships load lazily: only in space scenes, when a ship token exists, or when
  // the DM opens the spawner. loadShipReference() is several content requests
  // and must not fire on every ground map.
  const loadShips = useCallback(async () => {
    const seq = shipLoadSeq.current;
    const [starships, shipRules] = await Promise.all([
      import('../lib/starships'),
      import('../lib/shipRules'),
    ]);
    const [list, ref] = await Promise.all([starships.listStarships(campaignId), starships.loadShipReference()]);
    // The campaign switched (or reset) while these requests were in flight —
    // a newer load owns shipDocs/shipsLoadedFor now, so don't write stale data
    // over it (T8 review, Finding 1).
    if (seq !== shipLoadSeq.current) return list;
    const maxima = (s: any) => {
      const d = shipRules.computeShip(s.data_json, ref);
      return { maxHull: d.maxHull, maxShields: d.maxShields };
    };
    shipMaxima.current = maxima;
    shipDocs.current = Object.fromEntries(list.map((s: any) => [s.id, s]));
    // The chassis size key ('medium', 'large', …) lives on the reference row, not
    // on DerivedShip — this is the one place this plan reads it.
    const sizeKeyOf = (s: any): string | null => ref.sizes[s.data_json?.identity?.sizeId ?? '']?.key ?? null;
    setShips(list.map((s: any) => ({
      id: s.id, name: s.name, scale: shipTokenScale(sizeKeyOf(s)),
    })));
    shipsLoadedFor.current = campaignId;
    setShipVitals(applyPendingShipPlays(buildShipVitals(list as any[], maxima), pendingShipPlays.current));
    pendingShipPlays.current = {};
    return list;
  }, [campaignId]);

  const needShips = shipLoadNonce > 0
    || state.scene?.mode === 'space'
    || Object.values(state.tokens).some((t) => !!t.ship_id);

  useEffect(() => {
    shipLoadSeq.current += 1;
    shipsLoadedFor.current = null;
    shipDocs.current = {};
    pendingShipPlays.current = {};
    pendingShipPatch.current = {};
    spawningShips.current = new Set();
    setShips([]);
    setShipVitals({});
    setShipLoadNonce(0);
    setShipsLoading(false);
    setSpawningShipIds(new Set());
  }, [campaignId]);

  useEffect(() => {
    if (!needShips || shipsLoadedFor.current === campaignId) return;
    const seq = shipLoadSeq.current;
    setShipsLoading(true);
    loadShips()
      .then(() => {
        if (seq === shipLoadSeq.current) setError(null);
      })
      .catch((e: unknown) => {
        // Only touch state if this load is still the current one — a stale
        // failure from a load the campaign has since moved past must not undo
        // a newer (possibly successful) load's state (T8 review, Finding 1).
        if (seq !== shipLoadSeq.current) return;
        shipsLoadedFor.current = null; // latch cleared: the next loadShips() click genuinely retries
        setError(e instanceof Error ? e.message : 'Failed to load ships');
      })
      .finally(() => {
        if (seq === shipLoadSeq.current) setShipsLoading(false);
      });
  }, [needShips, campaignId, loadShips, shipLoadNonce]);

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
      if (env.type === 'ship:updated') {
        // The wire payload is {shipId, name, play, data_json} — data_json is the
        // full parsed document (see publishShipUpdated's doc comment on the
        // backend), included precisely so a build-half change elsewhere (a
        // refit, a crew edit) never leaves this hook's shipDocs cache stale.
        // Fall back to merging just `play` over the cached doc for tolerance
        // against a payload shape that omits it.
        const p = env.payload as { shipId?: string; name?: string; play?: ShipPlayLike; data_json?: any };
        const shipId = p?.shipId;
        const play = p?.play;
        if (!shipId || !play) return;
        // A setShipPlay PATCH for this ship is still in flight — keep local
        // play authoritative rather than re-basing from the wire, or a queued
        // click's optimistic edit gets silently overwritten by an echo of an
        // earlier click (T8 review, Finding 2). The in-flight PATCH's own
        // success/failure path (or, on failure, its loadShips() resync) is
        // what eventually reconciles state; still take the wire's build half
        // when present so a concurrent refit isn't lost.
        const patchPending = (pendingShipPatch.current[shipId] ?? 0) > 0;
        const doc = shipDocs.current[shipId];
        if (doc) {
          shipDocs.current[shipId] = patchPending
            ? { ...doc, name: p.name ?? doc.name, data_json: p.data_json ? { ...p.data_json, play: doc.data_json.play } : doc.data_json }
            : { ...doc, name: p.name ?? doc.name, data_json: p.data_json ?? { ...doc.data_json, play } };
        }
        if (shipsLoadedFor.current === null) {
          pendingShipPlays.current[shipId] = play; // loader in flight; don't let it clobber this
          return;
        }
        if (patchPending) return; // local optimistic play stays authoritative until the in-flight PATCH(es) settle
        // mergeShipPlay intentionally keeps cur.maxHull/maxShields (see its doc
        // comment in shipVitals.ts) — a refit's new maxima land in shipDocs above
        // but shipVitals' rings keep the old cap until reload; not a bug here.
        setShipVitals((v) => {
          if (v[shipId]) return mergeShipPlay(v, shipId, play);
          // Ship created after load: adopt it, mirroring the character path.
          import('../lib/starships')
            .then((m) => m.getStarship(shipId))
            .then((ship: any) => {
              shipDocs.current[shipId] = ship;
              setShipVitals((v2) => mergeShipPlay(addShipVitals(v2, ship, shipMaxima.current), shipId, play));
            })
            .catch(() => { /* deleted meanwhile; stay a silent no-op */ });
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
    shipVitals,
    ownShipIds,
    ships: { list: ships, loading: shipsLoading, spawning: spawningShipIds },
    templates: Object.values(state.templates),
    pings,
    rulers: Object.fromEntries(Object.entries(rulers).map(([k, { a, b }]) => [k, { a, b }])),
    initiative: parseInitiative(state.scene?.initiative_json ?? null),
    canMove: (t) => authed
      || (!!t.character_id && ownCharacterIds.has(t.character_id))
      || (!!t.ship_id && ownShipIds.has(t.ship_id)),
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
      // One PATCH: mode and the matching grid calibration (5 ft ground / 50 ft space).
      setSceneMode: wrap(async (id: string, mode: 'ground' | 'space') => {
        const grid = state.scene?.id === id ? state.scene.grid_json : null;
        await patchScene(id, {
          mode,
          ...(grid ? { grid: { ...grid, unitsPerHex: mode === 'space' ? 50 : 5, unitLabel: grid.unitLabel || 'ft' } } : {}),
        });
      }),
      rotate: wrap(async (tokenId: string, facing: number) => { await rotateToken(tokenId, facing, playerToken); }),
      setShipPlay: async (shipId: string, edit: (doc: any) => any) => {
        const doc = shipDocs.current[shipId];
        if (!doc) return;
        const next = edit(doc.data_json);
        shipDocs.current[shipId] = { ...doc, data_json: next };
        // Optimistic like commitFog: the condition ring must respond instantly.
        setShipVitals((v) => mergeShipPlay(v, shipId, next.play));
        // Track this PATCH as in-flight so a ship:updated echo landing before it
        // resolves doesn't rewind shipDocs/shipVitals out from under a queued
        // click (T8 review, Finding 2) — see the WS branch's patchPending guard.
        pendingShipPatch.current[shipId] = (pendingShipPatch.current[shipId] ?? 0) + 1;
        try {
          const m = await import('../lib/starships');
          await m.patchStarship(shipId, { data_json: next }, playerToken);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Ship update failed');
          // Only resync via a full reload once this is the last in-flight PATCH
          // for this ship: with others still pending, a reload would clobber
          // their optimistic edits before they get a chance to land or fail on
          // their own; loadShips() is itself seq-guarded (Finding 1's fix), so
          // it's safe to fire here — it just isn't the right ship-local trigger
          // while siblings are still outstanding.
          if ((pendingShipPatch.current[shipId] ?? 0) <= 1) {
            shipsLoadedFor.current = null;
            void loadShips().catch(() => { /* resync failed; rings go stale until reload */ });
          }
        } finally {
          const n = (pendingShipPatch.current[shipId] ?? 1) - 1;
          if (n <= 0) delete pendingShipPatch.current[shipId];
          else pendingShipPatch.current[shipId] = n;
        }
      },
      spawnShip: wrap(async (shipId: string) => {
        // spawnShip closes over render-time state (state.tokens, at least),
        // so two clicks landing inside the same token:created round-trip
        // would otherwise both compute the same open hex and stack two
        // tokens for this ship. Checked+set synchronously via the ref (not
        // setState) so the second click — even from a stale pre-update
        // closure — still observes the first click's write (T10 review,
        // Finding 3).
        if (spawningShips.current.has(shipId)) return;
        spawningShips.current.add(shipId);
        setSpawningShipIds(new Set(spawningShips.current));
        try {
          const scene = state.scene;
          const doc = shipDocs.current[shipId];
          if (!scene || !doc) return;
          const taken = new Set(Object.values(state.tokens).map((t) => hexKey({ q: t.q, r: t.r })));
          const spot = spawnPositions({ q: 0, r: 0 }, taken.size + 1).find((h) => !taken.has(hexKey(h))) ?? { q: 0, r: 0 };
          await createToken(scene.id, {
            name: doc.name,
            ship_id: shipId,
            faction: 'friendly',
            color: '#7aa2ff',
            scale: ships.find((s) => s.id === shipId)?.scale ?? 2,
            facing: 0,
            q: spot.q,
            r: spot.r,
          });
        } finally {
          spawningShips.current.delete(shipId);
          setSpawningShipIds(new Set(spawningShips.current));
        }
      }),
      loadShips: () => setShipLoadNonce((n) => n + 1),
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
      editTemplate: async (id: string, body: Record<string, unknown>) => {
        // Optimistic like commitFog: a dragged template must not snap back
        // for the round-trip window before the template:updated echo lands.
        setState((s) => (s.templates[id]
          ? { ...s, templates: { ...s.templates, [id]: { ...s.templates[id], ...body } } }
          : s));
        try {
          await patchTemplate(id, body, playerToken);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Template update failed');
          reload();
        }
      },
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
