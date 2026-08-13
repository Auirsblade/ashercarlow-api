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
  const { authed, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<StarshipDto | null>(null);
  const [build, setBuild] = useState<ShipBuild | null>(null);
  const [ref, setRef] = useState<ShipReferenceData | null>(null);
  const [play, setPlay] = useState<ShipPlayState | null>(null);
  const [ownCharacterIds, setOwnCharacterIds] = useState<string[]>([]);
  // True until the identity lookup below settles, whenever a token is present
  // — folded into `loading` (same "authLoading || hook loading" shape as
  // DMScreen/index.tsx:23-25's authLoading || dm.loading) so canEdit never
  // reads as false just because the getPlayerByToken race hasn't finished.
  const [identityLoading, setIdentityLoading] = useState(!!token);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `build`, but updated synchronously everywhere `build` is set, so
  // the debounced save below can compose its PATCH from the freshest known
  // document even if a WS ship:updated (someone else's refit, mid-debounce)
  // landed after dispatch() closed over the (now stale) `build` state.
  const latestBuildRef = useRef<ShipBuild | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getStarship(shipId), loadShipReference()])
      .then(([ship, reference]) => {
        if (!alive) return;
        setDto(ship);
        setRef(reference);
        setError(null);
        // A local edit is pending (debounce timer armed) — don't clobber it.
        // Mirrors the WS handler's own guard below, same rationale: our
        // in-flight PATCH hasn't landed yet, so this fetch's build/play are
        // stale relative to what the user is mid-typing.
        if (saveTimer.current) return;
        setBuild(ship.data_json);
        latestBuildRef.current = ship.data_json;
        setPlay(ship.data_json.play);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [shipId]);

  // DTO-only refresh: cheap (one GET, no reference refetch), and never flips
  // `loading` — a crew PUT/DELETE (CrewStrip's onReload) or a remote
  // ship:updated (below) used to re-run the FULL load effect, blanking the
  // whole sheet for every crew edit. Crew rides the DTO, so this alone keeps
  // crew/canEdit current without touching build/play.
  const reload = useCallback(() => {
    getStarship(shipId)
      .then(setDto)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to reload'));
  }, [shipId]);

  useEffect(() => {
    if (!token) { setOwnCharacterIds([]); setIdentityLoading(false); return; }
    let alive = true;
    setIdentityLoading(true);
    getPlayerByToken(token)
      .then((me) => alive && setOwnCharacterIds(me.characters.map((ch) => ch.id)))
      .catch(() => alive && setOwnCharacterIds([]))
      .finally(() => alive && setIdentityLoading(false));
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
        const payload = env.payload as { shipId?: string; play?: ShipPlayState; data_json?: ShipBuild } | undefined;
        if (payload?.shipId !== shipId) return;
        // Cheap DTO refresh — also covers name/crew changes, since crew rides
        // the DTO rather than the build document.
        reload();
        // The build half always re-bases from the wire: nothing on this
        // screen locally edits build (only play, guarded below), so there is
        // no local edit for a stale build to protect. This is what keeps a
        // remote refit (equipment, abilities) from going stale here forever.
        if (payload.data_json) {
          setBuild(payload.data_json);
          latestBuildRef.current = payload.data_json;
        }
        // While a local play edit is pending (debounce timer armed), skip the
        // play merge: our own earlier echo — or a concurrent writer — must not
        // clobber the newer local state. Once our PATCH fires, its echo matches
        // local state and merging is idempotent (last-write-wins).
        if (saveTimer.current) return;
        if (payload.play) setPlay(payload.play);
      },
      undefined,
      token,
    );
    return () => sock.close();
  }, [dto?.campaign_id, shipId, token, reload]);

  const canEdit = resolveShipCanEdit({
    admin: authed, token, playerCharacterIds: ownCharacterIds, crew: dto?.crew ?? [],
  });

  const dispatch = useCallback(
    (action: ShipPlayAction) => {
      if (!canEdit || !build || !derived || !play) return;
      const nextPlay = applyShipPlayAction({ ...build, play }, derived, action);
      setPlay(nextPlay);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null; // edit no longer pending; WS merges resume
        // Compose from the LATEST known build (the ref), not the build this
        // closure captured at dispatch() call time — a WS ship:updated may
        // have re-based it during the debounce window.
        const latestBuild = latestBuildRef.current ?? build;
        void patchStarship(shipId, { data_json: { ...latestBuild, play: nextPlay } }, token)
          .then(() => setError(null))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'));
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, derived, play, shipId, token],
  );

  return {
    loading: loading || authLoading || identityLoading,
    error, build, derived, ref, play, crew: dto?.crew ?? [], canEdit, dto, dispatch, reload,
  };
}
