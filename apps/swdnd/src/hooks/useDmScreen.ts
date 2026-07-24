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

export interface DmScreenState {
  loading: boolean;
  error: string | null;
  campaign: CampaignDto | null;
  cards: PartyCard[];
  players: PlayerDto[];
  actions: {
    renameCampaign: (name: string) => Promise<void>;
    addPlayer: (name: string) => Promise<void>;
    renamePlayerSlot: (id: string, name: string) => Promise<void>;
    removePlayer: (id: string) => Promise<void>;
    reload: () => void;
  };
}

export function useDmScreen(campaignId: string): DmScreenState {
  const [campaign, setCampaign] = useState<CampaignDto | null>(null);
  const [cards, setCards] = useState<PartyCard[]>([]);
  const [players, setPlayers] = useState<PlayerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refData = useRef<ReferenceData | null>(null);
  const cardsLoaded = useRef(false);
  const pending = useRef<PendingCardPlays>({});

  const reload = useCallback(() => {
    setLoading(true);
    cardsLoaded.current = false;
    pending.current = {};
    Promise.all([getCampaign(campaignId), listCharacters(campaignId), listPlayers(campaignId), loadReference()])
      .then(([camp, chars, slots, ref]) => {
        refData.current = ref;
        setCampaign(camp);
        setPlayers(slots);
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

  return {
    loading,
    error,
    campaign,
    cards,
    players,
    actions: {
      renameCampaign: wrap(async (name: string) => { setCampaign(await renameCampaign(campaignId, name)); }),
      addPlayer: wrap(async (name: string) => { await createPlayer(campaignId, name); await refreshPlayers(); }),
      renamePlayerSlot: wrap(async (id: string, name: string) => { await renamePlayer(id, name); await refreshPlayers(); }),
      removePlayer: wrap(async (id: string) => { await deletePlayer(id); await refreshPlayers(); }),
      reload,
    },
  };
}
