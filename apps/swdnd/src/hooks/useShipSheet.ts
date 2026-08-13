// apps/swdnd/src/hooks/useShipSheet.ts
// Shape copied verbatim from hooks/useCharacterSheet.ts, including the
// armed-save-timer WS-echo merge guard.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPlayerByToken } from '../lib/characters';
import {
  getStarship, loadShipReference, patchStarship, type ShipCrewMember, type StarshipDto,
} from '../lib/starships';
import { connectCampaign } from '../lib/ws';
import { useAuth } from '../lib/auth';
import { resolveShipCanEdit } from '../lib/canEdit';
import { applyShipPlayAction, type ShipPlayAction } from '../lib/shipPlayState';
import { computeShip } from '../lib/shipRules';
import type { DerivedShip, ShipBuild, ShipPlayState, ShipReferenceData } from '../lib/shipRules/types';

export interface ShipSheetState {
  loading: boolean;
  error: string | null;
  build: ShipBuild | null;
  derived: DerivedShip | null;
  ref: ShipReferenceData | null;
  play: ShipPlayState | null;
  crew: ShipCrewMember[];
  canEdit: boolean;
  dto: StarshipDto | null;
  dispatch: (action: ShipPlayAction) => void;
  reload: () => void;
}

const SAVE_DEBOUNCE_MS = 400;

export function useShipSheet(shipId: string): ShipSheetState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<StarshipDto | null>(null);
  const [build, setBuild] = useState<ShipBuild | null>(null);
  const [ref, setRef] = useState<ShipReferenceData | null>(null);
  const [play, setPlay] = useState<ShipPlayState | null>(null);
  const [ownCharacterIds, setOwnCharacterIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by reload() to re-run the load effect below (e.g. after a crew
  // PUT/DELETE) without restructuring the hook's single load path.
  const [reloadNonce, setReloadNonce] = useState(0);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getStarship(shipId), loadShipReference()])
      .then(([ship, reference]) => {
        if (!alive) return;
        setDto(ship);
        setBuild(ship.data_json);
        setPlay(ship.data_json.play);
        setRef(reference);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [shipId, reloadNonce]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    if (!token) { setOwnCharacterIds([]); return; }
    let alive = true;
    getPlayerByToken(token)
      .then((me) => alive && setOwnCharacterIds(me.characters.map((ch) => ch.id)))
      .catch(() => alive && setOwnCharacterIds([]));
    return () => { alive = false; };
  }, [token]);

  const derived = useMemo(() => (build && ref ? computeShip(build, ref) : null), [build, ref]);

  useEffect(() => {
    const campaignId = dto?.campaign_id;
    if (!campaignId) return;
    const sock = connectCampaign(
      campaignId,
      (env) => {
        if (env.type !== 'ship:updated') return;
        // While a local edit is pending (debounce timer armed), skip incoming
        // merges: our own earlier echo — or a concurrent writer — must not
        // clobber the newer local state. Once our PATCH fires, its echo matches
        // local state and merging is idempotent (last-write-wins).
        if (saveTimer.current) return;
        const payload = env.payload as { shipId?: string; play?: ShipPlayState } | undefined;
        if (payload?.shipId === shipId && payload.play) setPlay(payload.play);
      },
      undefined,
      token,
    );
    return () => sock.close();
  }, [dto?.campaign_id, shipId, token]);

  const canEdit = resolveShipCanEdit({
    admin: authed, token, playerCharacterIds: ownCharacterIds, crew: dto?.crew ?? [],
  });

  const dispatch = useCallback(
    (action: ShipPlayAction) => {
      if (!canEdit || !build || !derived || !play) return;
      const nextPlay = applyShipPlayAction({ ...build, play }, derived, action);
      setPlay(nextPlay);
      const nextBuild = { ...build, play: nextPlay };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null; // edit no longer pending; WS merges resume
        void patchStarship(shipId, { data_json: nextBuild }, token)
          .then(() => setError(null))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'));
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, derived, play, shipId, token],
  );

  return { loading, error, build, derived, ref, play, crew: dto?.crew ?? [], canEdit, dto, dispatch, reload };
}
