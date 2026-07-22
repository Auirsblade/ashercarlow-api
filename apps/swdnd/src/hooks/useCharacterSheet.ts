// apps/swdnd/src/hooks/useCharacterSheet.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCharacter, loadReference, patchCharacter, type CharacterDto } from '../lib/characters';
import { connectCampaign } from '../lib/ws';
import { useAuth } from '../lib/auth';
import { resolveCanEdit } from '../lib/canEdit';
import { applyPlayAction, type PlayAction } from '../lib/playState';
import { computeSheet } from '../lib/rules';
import type { CharacterBuild, DerivedSheet, PlayState, ReferenceData } from '../lib/rules/types';

export interface SheetState {
  loading: boolean;
  error: string | null;
  build: CharacterBuild | null;
  derived: DerivedSheet | null;
  ref: ReferenceData | null;
  play: PlayState | null;
  canEdit: boolean;
  dto: CharacterDto | null;
  dispatch: (action: PlayAction) => void;
}

const SAVE_DEBOUNCE_MS = 400;

export function useCharacterSheet(characterId: string): SheetState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<CharacterDto | null>(null);
  const [build, setBuild] = useState<CharacterBuild | null>(null);
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getCharacter(characterId), loadReference()])
      .then(([character, reference]) => {
        if (!alive) return;
        setDto(character);
        setBuild(character.data_json);
        setPlay(character.data_json.play);
        setRef(reference);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [characterId]);

  const derived = useMemo(
    () => (build && ref ? computeSheet(build, ref) : null),
    [build, ref],
  );

  useEffect(() => {
    const campaignId = dto?.campaign_id;
    if (!campaignId) return;
    const sock = connectCampaign(campaignId, (env) => {
      if (env.type !== 'character:updated') return;
      // While a local edit is pending (debounce timer armed), skip incoming
      // merges: our own earlier echo — or a concurrent writer — must not
      // clobber the newer local state. Once our PATCH fires, its echo matches
      // local state and merging is idempotent (last-write-wins).
      if (saveTimer.current) return;
      const payload = env.payload as { characterId?: string; play?: PlayState } | undefined;
      if (payload?.characterId === characterId && payload.play) {
        setPlay(payload.play);
      }
    });
    return () => sock.close();
  }, [dto?.campaign_id, characterId]);

  const canEdit = resolveCanEdit({ admin: authed, token });

  const dispatch = useCallback(
    (action: PlayAction) => {
      if (!canEdit || !build || !derived || !play) return;
      const nextPlay = applyPlayAction({ ...build, play }, derived, action);
      setPlay(nextPlay);
      const nextBuild = { ...build, play: nextPlay };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Deliberately NOT cleared on unmount: a pending timer flushes the last
      // edit rather than dropping it when the user navigates away.
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null; // edit no longer pending; WS merges resume
        void patchCharacter(characterId, { data_json: nextBuild }, token ?? undefined)
          .then(() => setError(null)) // a successful save clears any stale banner
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'));
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, derived, play, characterId, token],
  );

  return { loading, error, build, derived, ref, play, canEdit, dto, dispatch };
}
