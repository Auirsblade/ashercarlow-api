// apps/swdnd/src/hooks/useShipSheet.ts
// Shape copied verbatim from hooks/useCharacterSheet.ts, including the
// armed-save-timer WS-echo merge guard.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCharacter, getPlayerByToken, type CharacterDto } from '../lib/characters';
import { crewInputFrom, type CrewMemberInput } from '../lib/crew';
import {
  getStarship, loadShipReference, patchStarship, type ShipCrewMember, type StarshipDto,
} from '../lib/starships';
import { connectCampaign } from '../lib/ws';
import { useAuth } from '../lib/auth';
import { resolveShipCanEdit } from '../lib/canEdit';
import { applyShipPlayAction, type ShipPlayAction } from '../lib/shipPlayState';
import { computeShip } from '../lib/shipRules';
import { SHIP_ROLES } from '../lib/shipRules/constants';
import type { CrewInput, DerivedShip, ShipBuild, ShipPlayState, ShipReferenceData, ShipRole } from '../lib/shipRules/types';

export interface ShipSheetState {
  loading: boolean;
  error: string | null;
  build: ShipBuild | null;
  derived: DerivedShip | null;
  ref: ShipReferenceData | null;
  play: ShipPlayState | null;
  crew: ShipCrewMember[];
  crewMembers: Array<{ role: ShipRole; dto: CharacterDto }>;
  crewInput: CrewInput | undefined;
  canEdit: boolean;
  dto: StarshipDto | null;
  dispatch: (action: ShipPlayAction) => void;
  reload: () => void;
}

// starship_crew.role is unconstrained TEXT in the DB (only the write-path
// PUT validates against RoleEnum) -- a row inserted outside that path can
// carry a value outside the ShipRole union even though ShipCrewMember types
// it as ShipRole. Normalize + validate here, at the CrewMemberInput
// construction boundary, rather than trust the cast.
const SHIP_ROLE_SET = new Set<string>(SHIP_ROLES);
function normalizeShipRole(raw: string): ShipRole | null {
  const k = raw.trim().toLowerCase();
  return SHIP_ROLE_SET.has(k) ? (k as ShipRole) : null;
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

  const [crewMembers, setCrewMembers] = useState<Array<{ role: ShipRole; dto: CharacterDto }>>([]);
  // Mirrors `crewMembers`, so the WS callback below (recreated only on
  // [dto?.campaign_id, shipId, token, reload]) can read the current roster
  // instead of the stale snapshot it would otherwise close over.
  const crewMembersRef = useRef<Array<{ role: ShipRole; dto: CharacterDto }>>([]);
  useEffect(() => { crewMembersRef.current = crewMembers; }, [crewMembers]);

  // Stringify the roster's ids+roles so this effect doesn't re-run on an
  // identical roster (e.g. a DTO reload that leaves crew unchanged).
  const crewKey = (dto?.crew ?? []).map((c) => `${c.character_id}:${c.role}`).sort().join(',');

  useEffect(() => {
    const rows = dto?.crew ?? [];
    if (rows.length === 0) {
      setCrewMembers([]);
      return;
    }
    let alive = true;
    // One request per crewed character and nothing else: crewInputFrom derives
    // proficiency from the build document itself (crewProficiency), so the ship
    // sheet never pays for the ten-request character reference loader.
    Promise.all(rows.map((row) => getCharacter(row.character_id).catch(() => null)))
      .then((dtos) => {
        if (!alive) return;
        const members = rows.flatMap((row, i) => {
          const cdto = dtos[i];
          if (!cdto) return [];
          const role = normalizeShipRole(row.role);
          if (!role) {
            // Explicit drop, not a silent one: starship_crew.role is
            // unconstrained TEXT (only the write-path PUT validates against
            // RoleEnum), so a row inserted outside that path can carry a
            // value outside the ShipRole union even though ShipCrewMember
            // types it as ShipRole. Normalizing here -- where crewMembers is
            // set -- keeps the exported crewMembers.role sound everywhere
            // downstream (crewInput below, and the ship sheet's UI) instead
            // of leaving that to every consumer.
            console.debug(`[useShipSheet] dropping crew member ${cdto.id} with unrecognized role "${row.role}"`);
            return [];
          }
          return [{ role, dto: cdto }];
        });
        setCrewMembers(members);
      })
      .catch(() => { /* crew stats are additive: a failed load leaves the ship uncrewed */ });
    return () => { alive = false; };
  }, [crewKey]);

  const crewInput = useMemo(() => {
    if (!ref || crewMembers.length === 0) return undefined;
    // crewMembers' roles are already normalized+validated where the state is
    // set (the load effect above) -- no unsound role, and no render-phase
    // console.debug, left for this memo to do.
    const members: CrewMemberInput[] = crewMembers.map((m) => ({ role: m.role, build: m.dto.data_json }));
    return crewInputFrom(members, ref.deployments);
  }, [crewMembers, ref]);

  const derived = useMemo(
    () => (build && ref ? computeShip(build, ref, crewInput) : null),
    [build, ref, crewInput],
  );

  useEffect(() => {
    const campaignId = dto?.campaign_id;
    if (!campaignId) return;
    const sock = connectCampaign(
      campaignId,
      (env) => {
        if (env.type === 'character:updated') {
          // A crewed character's deployments live in their build, which the
          // thin payload doesn't carry — refetch that one character. This is
          // independent of local ship edits, so it needs no save-timer guard.
          const payload = env.payload as { characterId?: string } | undefined;
          const id = payload?.characterId;
          if (id && crewMembersRef.current.some((m) => m.dto.id === id)) {
            void getCharacter(id).then((fresh) => {
              setCrewMembers((prev) => prev.map((m) => (m.dto.id === id ? { ...m, dto: fresh } : m)));
            }).catch(() => { /* transient: the next mount recomputes */ });
          }
          return;
        }
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
    error, build, derived, ref, play, crew: dto?.crew ?? [], crewMembers, crewInput,
    canEdit, dto, dispatch, reload,
  };
}
