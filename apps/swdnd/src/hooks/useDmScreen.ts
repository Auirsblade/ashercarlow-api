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
import { spawnBodies, spawnPositions } from '../lib/spawn';
import {
  createEncounter, deleteEncounter, listEncounters, patchEncounter,
  type EncounterDto, type EncounterMonster,
} from '../lib/encounters';

export interface PowerEntry extends RefEntry { level: number; castType: 'force' | 'tech' }

export interface DmScreenState {
  loading: boolean;
  error: string | null;
  campaign: CampaignDto | null;
  cards: PartyCard[];
  players: PlayerDto[];
  monsters: MonsterView[];
  refEntries: { conditions: RefEntry[]; weaponProperties: RefEntry[]; powers: PowerEntry[] };
  encounters: EncounterDto[];
  actions: {
    renameCampaign: (name: string) => Promise<void>;
    addPlayer: (name: string) => Promise<void>;
    renamePlayerSlot: (id: string, name: string) => Promise<void>;
    removePlayer: (id: string) => Promise<void>;
    spawn: (view: MonsterView, count: number) => Promise<void>;
    spawnEncounter: (enc: EncounterDto) => Promise<void>;
    addEncounter: (name: string) => Promise<void>;
    renameEncounter: (id: string, name: string) => Promise<void>;
    setEncounterMonsters: (id: string, monsters: EncounterMonster[]) => Promise<void>;
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
  const refData = useRef<ReferenceData | null>(null);
  const cardsLoaded = useRef(false);
  const pending = useRef<PendingCardPlays>({});

  const reload = useCallback(() => {
    setLoading(true);
    cardsLoaded.current = false;
    pending.current = {};
    Promise.all([
      getCampaign(campaignId), listCharacters(campaignId), listPlayers(campaignId), loadReference(),
      api<MonsterRow[]>('/swdnd/content/monsters'),
      api<RefRow[]>('/swdnd/content/conditions'),
      api<RefRow[]>('/swdnd/content/weapon_properties'),
      listEncounters(campaignId),
    ])
      .then(([camp, chars, slots, ref, monsterRows, conditionRows, wpRows, encs]) => {
        refData.current = ref;
        setCampaign(camp);
        setPlayers(slots);
        setMonsters(monsterRows.map(parseMonster).sort((a, b) => a.name.localeCompare(b.name)));
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

  // Spawn composes the existing token routes against the ACTIVE scene; tokens
  // appear on every viewer via the existing token:created broadcasts.
  const spawnMany = useCallback(async (groups: { view: MonsterView; count: number }[]) => {
    const scenes = await listScenes(campaignId);
    const active = scenes.find((s) => s.is_active === 1);
    if (!active) throw new Error('No active scene to spawn onto — activate one on the map first.');
    const cx = (active.image_w ?? 0) / 2;
    const cy = (active.image_h ?? 0) / 2;
    const center = active.grid_json ? pixelToHex(cx, cy, active.grid_json) : { q: 0, r: 0 };
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const positions = spawnPositions(center, total);
    let used = 0;
    for (const g of groups) {
      const bodies = spawnBodies(g.view, g.count, positions.slice(used, used + g.count));
      used += g.count;
      for (const body of bodies) await createToken(active.id, body);
    }
  }, [campaignId]);

  const refreshEncounters = useCallback(
    () => listEncounters(campaignId).then(setEncounters),
    [campaignId],
  );

  return {
    loading,
    error,
    campaign,
    cards,
    players,
    monsters,
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
        if (groups.length === 0) throw new Error('No known monsters in this encounter.');
        await spawnMany(groups);
      }),
      addEncounter: wrap(async (name: string) => { await createEncounter(campaignId, name); await refreshEncounters(); }),
      renameEncounter: wrap(async (id: string, name: string) => { await patchEncounter(id, { name }); await refreshEncounters(); }),
      setEncounterMonsters: wrap(async (id: string, monsters: EncounterMonster[]) => {
        await patchEncounter(id, { monsters });
        await refreshEncounters();
      }),
      removeEncounter: wrap(async (id: string) => { await deleteEncounter(id); await refreshEncounters(); }),
      reload,
    },
  };
}
