// apps/swdnd/src/hooks/useShipBuilder.ts
// Shape copied verbatim from hooks/useBuilder.ts: load -> useMemo(compute) ->
// optimistic dispatch -> debounced PATCH.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPlayerByToken } from '../lib/characters';
import { getStarship, loadShipReference, patchStarship, type StarshipDto } from '../lib/starships';
import { useAuth } from '../lib/auth';
import { resolveShipCanEdit } from '../lib/canEdit';
import { applyShipBuildAction, type ShipBuildAction } from '../lib/shipBuildState';
import { shipStepStatus, type ShipStepKey } from '../lib/shipValidation';
import { computeShip } from '../lib/shipRules';
import type { DerivedShip, ShipBuild, ShipReferenceData } from '../lib/shipRules/types';
import type { StepInfo } from '../lib/validation';

export interface ShipBuilderState {
  loading: boolean;
  error: string | null;
  build: ShipBuild | null;
  derived: DerivedShip | null;
  ref: ShipReferenceData | null;
  status: Record<ShipStepKey, StepInfo> | null;
  canEdit: boolean;
  dto: StarshipDto | null;
  saving: boolean;
  dispatch: (action: ShipBuildAction) => void;
}

const SAVE_DEBOUNCE_MS = 500;

export function useShipBuilder(shipId: string): ShipBuilderState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<StarshipDto | null>(null);
  const [build, setBuild] = useState<ShipBuild | null>(null);
  const [ref, setRef] = useState<ShipReferenceData | null>(null);
  const [ownCharacterIds, setOwnCharacterIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // loadShipReference is SEPARATE from loadReference on purpose — a ship
    // screen must not pay for the 10 character-content requests.
    Promise.all([getStarship(shipId), loadShipReference()])
      .then(([ship, reference]) => {
        if (!alive) return;
        setDto(ship);
        setBuild(ship.data_json);
        setRef(reference);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [shipId]);

  useEffect(() => {
    if (!token) { setOwnCharacterIds([]); return; }
    let alive = true;
    // A failed lookup just means "no player identity" -> read-only, not an error banner.
    getPlayerByToken(token)
      .then((me) => alive && setOwnCharacterIds(me.characters.map((ch) => ch.id)))
      .catch(() => alive && setOwnCharacterIds([]));
    return () => { alive = false; };
  }, [token]);

  const derived = useMemo(() => (build && ref ? computeShip(build, ref) : null), [build, ref]);
  const status = useMemo(
    () => (build && ref && derived ? shipStepStatus(build, ref, derived) : null),
    [build, ref, derived],
  );

  const canEdit = resolveShipCanEdit({
    admin: authed, token, playerCharacterIds: ownCharacterIds, crew: dto?.crew ?? [],
  });

  const dispatch = useCallback(
    (action: ShipBuildAction) => {
      if (!canEdit || !build || !ref || !derived) return;
      const next = applyShipBuildAction(build, ref, derived, action);
      setBuild(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      // Deliberately NOT cleared on unmount: a pending timer flushes the last
      // edit rather than dropping it when the user navigates away.
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void patchStarship(shipId, { name: next.identity.name || undefined, data_json: next }, token)
          .then(() => setError(null))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
          .finally(() => setSaving(false));
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, ref, derived, shipId, token],
  );

  return { loading, error, build, derived, ref, status, canEdit, dto, saving, dispatch };
}
