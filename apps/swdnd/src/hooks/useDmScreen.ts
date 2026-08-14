// apps/swdnd/src/hooks/useDmScreen.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectCampaign, type WsEnvelope } from '../lib/ws';
import { getCampaign, renameCampaign, type CampaignDto } from '../lib/campaigns';
import {
  createPlayer, deletePlayer, getCharacter, listCharacters, listPlayers, loadReference,
  renamePlayer, type PlayerDto,
} from '../lib/characters';
import {
  addCard, applyPendingCardPlays, buildCards, mergeCardPlay,
  type PartyCard, type PendingCardPlays, type PlayPayload,
} from '../lib/partyCards';
import type { ReferenceData } from '../lib/rules/types';
import { api } from '../lib/api';
import { listScenes, createToken } from '../lib/scenes';
import { pixelToHex } from '../lib/hex';
import { parseMonster, type MonsterRow, type MonsterView } from '../lib/monsters';
import { refEntryFromRow, type RefEntry, type RefRow } from '../lib/refSearch';
import { spawnBodies, spawnPositions, copyName, shipSpawnBody } from '../lib/spawn';
import {
  createEncounter, deleteEncounter, listEncounters, patchEncounter,
  type EncounterDto, type EncounterMonster, type EncounterShip,
} from '../lib/encounters';
import {
  createShipFromBuild, fillStockPlay, getStarship, listStarships, listStockShips, loadShipReference,
  parseStockShip, shipRefIndex, ShipBuildPatchError, stockToShipBuild,
  type StockShipView,
} from '../lib/starships';
import {
  addShipCard, applyPendingShipCards, buildShipCards, mergeShipCardPlay, type ShipCard,
} from '../lib/shipCards';
// One buffered-play cache for the whole app — sub-project 3 owns its shape.
import { shipVitalsFrom, type PendingShipPlays, type ShipPlayLike } from '../lib/shipVitals';
import { computeShip } from '../lib/shipRules';
import type { ShipReferenceData } from '../lib/shipRules/types';
import { shipTokenScale } from '../lib/shipTokens';
import type { Hex } from '../lib/hex';

export interface PowerEntry extends RefEntry { level: number; castType: 'force' | 'tech' }

export interface DmScreenState {
  loading: boolean;
  error: string | null;
  campaign: CampaignDto | null;
  cards: PartyCard[];
  players: PlayerDto[];
  monsters: MonsterView[];
  stockShips: StockShipView[];
  shipCards: ShipCard[];
  shipRef: ShipReferenceData | null;
  refEntries: { conditions: RefEntry[]; weaponProperties: RefEntry[]; powers: PowerEntry[] };
  encounters: EncounterDto[];
  actions: {
    renameCampaign: (name: string) => Promise<void>;
    addPlayer: (name: string) => Promise<void>;
    renamePlayerSlot: (id: string, name: string) => Promise<void>;
    removePlayer: (id: string) => Promise<void>;
    spawn: (view: MonsterView, count: number) => Promise<void>;
    spawnEncounter: (enc: EncounterDto) => Promise<void>;
    addShipToFleet: (view: StockShipView) => Promise<void>;
    spawnShip: (view: StockShipView, count: number) => Promise<void>;
    addEncounter: (name: string) => Promise<void>;
    renameEncounter: (id: string, name: string) => Promise<void>;
    setEncounterMonsters: (id: string, monsters: EncounterMonster[]) => Promise<void>;
    setEncounterShips: (id: string, ships: EncounterShip[]) => Promise<void>;
    removeEncounter: (id: string) => Promise<void>;
    reload: () => void;
  };
}

export function useDmScreen(campaignId: string): DmScreenState {
  const [campaign, setCampaign] = useState<CampaignDto | null>(null);
  const [cards, setCards] = useState<PartyCard[]>([]);
  const [players, setPlayers] = useState<PlayerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monsters, setMonsters] = useState<MonsterView[]>([]);
  const [refEntries, setRefEntries] = useState<DmScreenState['refEntries']>({ conditions: [], weaponProperties: [], powers: [] });
  const [encounters, setEncounters] = useState<EncounterDto[]>([]);
  const [stockShips, setStockShips] = useState<StockShipView[]>([]);
  const [shipCards, setShipCards] = useState<ShipCard[]>([]);
  const [shipRef, setShipRef] = useState<ShipReferenceData | null>(null);
  const refData = useRef<ReferenceData | null>(null);
  const shipRefData = useRef<ShipReferenceData | null>(null);
  const cardsLoaded = useRef(false);
  const shipCardsLoaded = useRef(false);
  const pending = useRef<PendingCardPlays>({});
  const pendingShips = useRef<PendingShipPlays>({});
  /** Names carried by those buffered events — the shared cache holds play only. */
  const pendingShipNames = useRef<Record<string, string>>({});

  const reload = useCallback(() => {
    setLoading(true);
    cardsLoaded.current = false;
    shipCardsLoaded.current = false;
    pending.current = {};
    pendingShips.current = {};
    pendingShipNames.current = {};
    Promise.all([
      getCampaign(campaignId), listCharacters(campaignId), listPlayers(campaignId), loadReference(),
      api<MonsterRow[]>('/swdnd/content/monsters'),
      api<RefRow[]>('/swdnd/content/conditions'),
      api<RefRow[]>('/swdnd/content/weapon_properties'),
      listEncounters(campaignId),
      listStockShips(),
      listStarships(campaignId),
      loadShipReference(),
    ])
      .then(([camp, chars, slots, ref, monsterRows, conditionRows, wpRows, encs, stockRows, ships, sref]) => {
        refData.current = ref;
        shipRefData.current = sref;
        setShipRef(sref);
        setCampaign(camp);
        setPlayers(slots);
        setMonsters(monsterRows.map(parseMonster).sort((a, b) => a.name.localeCompare(b.name)));
        setStockShips(stockRows.map(parseStockShip).sort((a, b) => a.name.localeCompare(b.name)));
        setRefEntries({
          conditions: conditionRows.map(refEntryFromRow),
          weaponProperties: wpRows.map(refEntryFromRow),
          powers: Object.values(ref.powers)
            .map((p) => ({ id: p.id, name: p.name, text: p.description, level: p.level, castType: p.castType }))
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        });
        setEncounters(encs);
        cardsLoaded.current = true;
        setCards(applyPendingCardPlays(buildCards(chars, ref), pending.current));
        pending.current = {};
        shipCardsLoaded.current = true;
        setShipCards(applyPendingShipCards(buildShipCards(ships, sref), pendingShips.current, pendingShipNames.current));
        pendingShips.current = {};
        pendingShipNames.current = {};
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [campaignId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    const hadOpenedRef = { current: false };
    const sock = connectCampaign(campaignId, (env: WsEnvelope) => {
      if (env.type === 'campaign:updated') {
        setCampaign(env.payload as CampaignDto);
        return;
      }
      if (env.type === 'ship:updated') {
        // Wire payload is {shipId, name, play, data_json}; data_json isn't
        // needed here (shipCards derives everything from play + the cached
        // ref). `play` itself is unknown-typed on the wire and
        // mergeShipCardPlay trusts its input (spreads play.conditions
        // directly) — narrow/clamp it here first, reusing shipVitalsFrom's
        // tolerant coercion so a doc missing play.conditions (or any other
        // field) degrades to a safe default instead of throwing.
        const s = env.payload as { shipId?: string; name?: string; play?: unknown };
        if (!s?.shipId || !s.play || typeof s.name !== 'string') return;
        const { shipId, name } = s as { shipId: string; name: string };
        const raw = shipVitalsFrom(s.play as Partial<ShipPlayLike>, null);
        const play: ShipPlayLike = { hull: raw.hull, shields: raw.shields, conditions: raw.conditions, systemDamage: raw.systemDamage };
        if (!shipCardsLoaded.current) {
          pendingShips.current[shipId] = play;
          pendingShipNames.current[shipId] = name;
          return;
        }
        setShipCards((cur) => {
          if (cur.some((c) => c.id === shipId)) return mergeShipCardPlay(cur, shipId, name, play);
          // Unknown id: ship created after load (another DM tab spawning). Adopt it.
          const sref = shipRefData.current;
          if (sref) {
            getStarship(shipId)
              .then((sdto) => {
                const r = shipRefData.current;
                if (!r) return;
                setShipCards((c2) => mergeShipCardPlay(addShipCard(c2, sdto, r), shipId, name, play));
              })
              .catch(() => { /* deleted in the gap; stay a silent no-op */ });
          }
          return cur;
        });
        return;
      }
      if (env.type !== 'character:updated') return;
      const p = env.payload as { characterId?: string; name?: string; play?: PlayPayload };
      if (!p?.characterId || !p.play || typeof p.name !== 'string') return;
      const { characterId, name, play } = p as { characterId: string; name: string; play: PlayPayload };
      if (!cardsLoaded.current) {
        // Loader hasn't resolved yet; buffer so the eventual buildCards()
        // doesn't clobber this update with a stale snapshot.
        pending.current[characterId] = { name, play };
        return;
      }
      setCards((cur) => {
        if (cur.some((c) => c.id === characterId)) return mergeCardPlay(cur, characterId, name, play);
        // Unknown id: character created after load. Fetch its DTO and adopt it.
        if (refData.current) {
          getCharacter(characterId)
            .then((dto) => {
              const ref = refData.current;
              if (!ref) return;
              setCards((c2) => mergeCardPlay(addCard(c2, dto, ref), characterId, name, play));
            })
            .catch(() => { /* deleted in the gap; stay a silent no-op */ });
        }
        return cur;
      });
    }, (open) => {
      // Events during a dropped-connection gap are lost; resync on every
      // reconnect after the initial open (the initial load already fetches).
      if (open) {
        if (hadOpenedRef.current) reload();
        hadOpenedRef.current = true;
      }
    });
    return () => sock.close();
  }, [campaignId, reload]);

  // Player mutations have no WS echo — refetch the slot list after each.
  const refreshPlayers = useCallback(
    () => listPlayers(campaignId).then(setPlayers),
    [campaignId],
  );

  const wrap = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    async (...a: A) => {
      try { await fn(...a); setError(null); }
      catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    };

  /** The active scene plus the hex under its image centre. */
  const activeSceneCenter = useCallback(async (): Promise<{ sceneId: string; center: Hex }> => {
    const scenes = await listScenes(campaignId);
    const active = scenes.find((s) => s.is_active === 1);
    if (!active) throw new Error('No active scene to spawn onto — activate one on the map first.');
    const cx = (active.image_w ?? 0) / 2;
    const cy = (active.image_h ?? 0) / 2;
    const center = active.grid_json ? pixelToHex(cx, cy, active.grid_json) : { q: 0, r: 0 };
    return { sceneId: active.id, center };
  }, [campaignId]);

  // Spawn composes the existing token routes against the ACTIVE scene; tokens
  // appear on every viewer via the existing token:created broadcasts.
  const spawnMany = useCallback(async (groups: { view: MonsterView; count: number }[]) => {
    const { sceneId, center } = await activeSceneCenter();
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const positions = spawnPositions(center, total);
    let used = 0;
    for (const g of groups) {
      const bodies = spawnBodies(g.view, g.count, positions.slice(used, used + g.count));
      used += g.count;
      for (const body of bodies) await createToken(sceneId, body);
    }
  }, [activeSceneCenter]);

  const refreshEncounters = useCallback(
    () => listEncounters(campaignId).then(setEncounters),
    [campaignId],
  );

  const refreshFleet = useCallback(async () => {
    const sref = shipRefData.current;
    if (!sref) return;
    setShipCards(buildShipCards(await listStarships(campaignId), sref));
  }, [campaignId]);

  /** One real `starship` row per copy, then one bound token each. `skip` leaves
   * room for tokens another group already placed in the same centre-out ring. */
  const spawnShipGroups = useCallback(async (groups: { view: StockShipView; count: number }[], skip = 0) => {
    const sref = shipRefData.current;
    if (!sref) throw new Error('Ship reference not loaded yet — reload the DM screen.');
    const idx = shipRefIndex(sref);
    const { sceneId, center } = await activeSceneCenter();
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const positions = spawnPositions(center, skip + total).slice(skip);
    let used = 0;
    try {
      for (const g of groups) {
        const base = stockToShipBuild(g.view, idx);
        const build = fillStockPlay(base, computeShip(base, sref));
        const scale = shipTokenScale(sref.sizes[build.identity.sizeId]?.key ?? null);
        for (let i = 0; i < g.count; i++) {
          const name = copyName(g.view.name, i);
          // Same partial-failure shape as addShipToFleet: createShipFromBuild
          // tags a PATCH-leg failure with ShipBuildPatchError (row created,
          // real build never saved) — only that case leaves an orphan,
          // token-less row worth naming explicitly. A plain POST failure
          // creates nothing, so let it propagate for wrap()'s generic
          // handler instead of a misleading orphan-ship warning.
          const ship = await createShipFromBuild(campaignId, { ...build, identity: { ...build.identity, name } })
            .catch((e: unknown) => {
              if (!(e instanceof ShipBuildPatchError)) throw e;
              throw new Error(
                `"${name}" may have been created with blank stats and no token (its data failed to save) — check the fleet before retrying. (${e.message})`,
              );
            });
          const pos = positions[used++];
          // The ship row exists at this point either way; a token-placement
          // failure here still leaves it stranded off the map, so name it
          // just as explicitly instead of surfacing the generic 'Request
          // failed'.
          await createToken(sceneId, shipSpawnBody(ship.id, name, build.play.hull, build.play.hull, pos, 0, scale))
            .catch((e: unknown) => {
              throw new Error(
                `"${name}" was created but its token failed to place — check the fleet before retrying.${e instanceof Error ? ` (${e.message})` : ''}`,
              );
            });
        }
      }
    } finally {
      // Refresh regardless of outcome so any row(s) already created before a
      // mid-batch failure aren't hidden from the fleet rail until reload.
      // Swallow a refresh failure — it must not replace the more actionable
      // per-copy error already in flight from the loop above.
      await refreshFleet().catch(() => {});
    }
  }, [activeSceneCenter, campaignId, refreshFleet]);

  return {
    loading,
    error,
    campaign,
    cards,
    players,
    monsters,
    stockShips,
    shipCards,
    shipRef,
    refEntries,
    encounters,
    actions: {
      renameCampaign: wrap(async (name: string) => { setCampaign(await renameCampaign(campaignId, name)); }),
      addPlayer: wrap(async (name: string) => { await createPlayer(campaignId, name); await refreshPlayers(); }),
      renamePlayerSlot: wrap(async (id: string, name: string) => { await renamePlayer(id, name); await refreshPlayers(); }),
      removePlayer: wrap(async (id: string) => { await deletePlayer(id); await refreshPlayers(); }),
      spawn: wrap(async (view: MonsterView, count: number) => { await spawnMany([{ view, count }]); }),
      spawnEncounter: wrap(async (enc: EncounterDto) => {
        const byId = new Map(monsters.map((m) => [m.id, m]));
        const groups = enc.monsters_json
          .map((e) => ({ view: byId.get(e.monsterId), count: e.count }))
          .filter((g): g is { view: MonsterView; count: number } => !!g.view);
        // Ship members are resolved tolerantly: refs to a stock ship deleted
        // from the pack since the encounter was built (or a rare duplicate
        // entry — nothing dedupes ships_json at rest) must never abort the
        // whole spawn. Known groups still spawn; dangling refs are counted
        // and surfaced as a note below instead of a silent drop.
        const shipById = new Map(stockShips.map((s) => [s.id, s]));
        const shipGroups: { view: StockShipView; count: number }[] = [];
        const danglingRefs: string[] = [];
        for (const e of enc.ships_json) {
          const view = shipById.get(e.stockShipRef);
          if (view) shipGroups.push({ view, count: e.count });
          else danglingRefs.push(e.stockShipRef);
        }
        if (groups.length === 0 && shipGroups.length === 0) {
          throw new Error(
            danglingRefs.length > 0
              ? `No known monsters or ships in this encounter (${danglingRefs.length} ship ref(s) no longer in the stock pack).`
              : 'No known monsters or ships in this encounter.',
          );
        }
        if (groups.length > 0) await spawnMany(groups);
        if (shipGroups.length > 0) {
          const monsterTotal = groups.reduce((sum, g) => sum + g.count, 0);
          await spawnShipGroups(shipGroups, monsterTotal);
        }
        // Throw after the real work above so a partial spawn (known members
        // placed) still lands even when some ship refs no longer resolve —
        // same "note via the error banner" convention as the partial-failure
        // messages in spawnShipGroups/addShipToFleet above.
        if (danglingRefs.length > 0) {
          throw new Error(
            `Spawned the rest, but skipped ${danglingRefs.length} ship${danglingRefs.length === 1 ? '' : 's'} no longer in the stock pack.`,
          );
        }
      }),
      addShipToFleet: wrap(async (view: StockShipView) => {
        const sref = shipRefData.current;
        if (!sref) throw new Error('Ship reference not loaded yet — reload the DM screen.');
        const base = stockToShipBuild(view, shipRefIndex(sref));
        try {
          await createShipFromBuild(campaignId, fillStockPlay(base, computeShip(base, sref)));
        } catch (e) {
          // createShipFromBuild tags a PATCH-leg failure with
          // ShipBuildPatchError (row created via POST with a blank build,
          // then the real build failed to save) — that's the only case that
          // leaves a real, blank-build ship in the fleet, so only it gets
          // the distinct warning. A plain POST failure created nothing; let
          // it propagate so wrap()'s generic handler surfaces it instead of
          // a misleading orphan-ship warning.
          if (!(e instanceof ShipBuildPatchError)) throw e;
          throw new Error(
            `"${view.name}" may have been created with blank stats (its data failed to save) — check the fleet before retrying. (${e.message})`,
          );
        } finally {
          // Refresh regardless of outcome so a partially-created row isn't
          // hidden from the fleet rail until the next full reload. Swallow a
          // refresh failure here — it must not replace the more actionable
          // error already in flight from the try block above.
          await refreshFleet().catch(() => {});
        }
      }),
      spawnShip: wrap(async (view: StockShipView, count: number) => {
        await spawnShipGroups([{ view, count }]);
      }),
      addEncounter: wrap(async (name: string) => { await createEncounter(campaignId, name); await refreshEncounters(); }),
      renameEncounter: wrap(async (id: string, name: string) => { await patchEncounter(id, { name }); await refreshEncounters(); }),
      setEncounterMonsters: wrap(async (id: string, monsters: EncounterMonster[]) => {
        await patchEncounter(id, { monsters });
        await refreshEncounters();
      }),
      setEncounterShips: wrap(async (id: string, ships: EncounterShip[]) => {
        await patchEncounter(id, { ships });
        await refreshEncounters();
      }),
      removeEncounter: wrap(async (id: string) => { await deleteEncounter(id); await refreshEncounters(); }),
      reload,
    },
  };
}
