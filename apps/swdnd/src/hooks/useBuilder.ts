import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCharacter, loadReference, patchCharacter, type CharacterDto } from '../lib/characters';
import { useAuth } from '../lib/auth';
import { resolveCanEdit } from '../lib/canEdit';
import { applyBuildAction, type BuildAction } from '../lib/buildState';
import { stepStatus, type StepKey, type StepInfo } from '../lib/validation';
import { computeSheet } from '../lib/rules';
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../lib/rules/types';

export interface BuilderState {
  loading: boolean;
  error: string | null;
  build: CharacterBuild | null;
  derived: DerivedSheet | null;
  ref: ReferenceData | null;
  status: Record<StepKey, StepInfo> | null;
  canEdit: boolean;
  dto: CharacterDto | null;
  saving: boolean;
  dispatch: (action: BuildAction) => void;
}

const SAVE_DEBOUNCE_MS = 500;

export function useBuilder(characterId: string): BuilderState {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [dto, setDto] = useState<CharacterDto | null>(null);
  const [build, setBuild] = useState<CharacterBuild | null>(null);
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getCharacter(characterId), loadReference()])
      .then(([character, reference]) => {
        if (!alive) return;
        setDto(character);
        setBuild(character.data_json);
        setRef(reference);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [characterId]);

  const derived = useMemo(() => (build && ref ? computeSheet(build, ref) : null), [build, ref]);
  const status = useMemo(
    () => (build && ref && derived ? stepStatus(build, ref, derived) : null),
    [build, ref, derived],
  );

  const canEdit = resolveCanEdit({ admin: authed, token });

  const dispatch = useCallback(
    (action: BuildAction) => {
      if (!canEdit || !build || !ref || !derived) return;
      const next = applyBuildAction(build, ref, derived, action);
      setBuild(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void patchCharacter(characterId, { name: next.identity.name || undefined, data_json: next }, token ?? undefined)
          .then(() => setError(null))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
          .finally(() => setSaving(false));
      }, SAVE_DEBOUNCE_MS);
    },
    [canEdit, build, ref, derived, characterId, token],
  );

  return { loading, error, build, derived, ref, status, canEdit, dto, saving, dispatch };
}
