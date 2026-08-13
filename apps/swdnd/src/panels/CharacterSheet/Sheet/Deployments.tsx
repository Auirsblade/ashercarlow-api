// apps/swdnd/src/panels/CharacterSheet/Sheet/Deployments.tsx
import { useEffect, useState } from 'react';
import { currentTechDie, TECH_DIE_LADDER } from '../../../lib/crew';
import type { PlayAction } from '../../../lib/playState';
import { deploymentsOf, prestigeOf } from '../../../lib/rules/core';
import type { CharacterBuild, PlayState } from '../../../lib/rules/types';
import { loadDeploymentReference } from '../../../lib/starships';
import type { DeploymentReferenceData } from '../../../lib/shipRules/types';

interface Props {
  build: CharacterBuild;
  play: PlayState;
  editable: boolean;
  dispatch: (a: PlayAction) => void;
}

export default function Deployments({ build, play, editable, dispatch }: Props) {
  const [ref, setRef] = useState<DeploymentReferenceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const entries = deploymentsOf(build);

  useEffect(() => {
    if (entries.length === 0) return;      // nothing to name: skip the two requests entirely
    let alive = true;
    setError(null);
    loadDeploymentReference()
      .then((r) => alive && setRef(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load deployments'));
    return () => { alive = false; };
  }, [entries.length, attempt]);

  if (entries.length === 0) return null;

  // deploymentId -> role only exists in the reference (content-pack ids are
  // opaque, not role slugs — e.g. Mechanic is "NCOjzgFbOg6DsjSF" in the pack),
  // so the tech die genuinely cannot be derived from the build alone. Instead
  // of letting a failed fetch silently erase the control (a Mechanic reading
  // "no tech die" with no explanation), surface the failure with a retry.
  const tech = ref ? currentTechDie(build, play, ref.deployments) : null;
  const techIdx = tech ? Math.max(0, TECH_DIE_LADDER.indexOf(tech.current)) : 0;
  const stepTech = (delta: 1 | -1) => {
    if (!tech) return;
    const next = TECH_DIE_LADDER[Math.max(0, Math.min(TECH_DIE_LADDER.length - 1, techIdx + delta))];
    dispatch({ t: 'setTechDie', sides: next });
  };
  const retry = () => { setError(null); setAttempt((n) => n + 1); };

  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1 flex justify-between">
        <span>Deployments</span>
        <span className="text-ht-muted">{prestigeOf(build)} prestige</span>
      </div>

      {error && (
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-red-300">
          <span>⚠ {error} — names, features, and tech die may be incomplete</span>
          <button type="button" className="ht-step" onClick={retry}>retry</button>
        </div>
      )}
      {!ref && !error && (
        <div className="mb-1 text-[10px] text-ht-muted">Loading deployments…</div>
      )}

      {entries.map((e) => {
        const d = ref?.deployments[e.deploymentId];
        const features = Object.values(ref?.deploymentFeatures ?? {})
          .filter((f) => f.role === d?.role && f.rank > 0 && f.rank <= e.rank)
          .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
        return (
          <div key={e.deploymentId} className="mt-1 border-t border-ht-line pt-1">
            <div className="flex justify-between text-ht-text">
              <span>{d?.name ?? e.deploymentId}</span>
              <span className="text-ht-muted">rank {e.rank}</span>
            </div>
            {features.map((f) => (
              <div key={f.id} className="flex justify-between gap-2 text-[10px] text-ht-muted">
                <span>{f.rank} · {f.name}</span>
                <span>{f.powerSystem ? `${f.powerSystem} die` : ''}{f.activation ? ` · ${f.activation}` : ''}</span>
              </div>
            ))}
          </div>
        );
      })}

      {tech && tech.base > 0 && (
        <div className="mt-2 border-t border-ht-line pt-1">
          <div className="flex items-center justify-between text-ht-text">
            <span>Tech die</span>
            <span className="inline-flex items-center gap-1.5">
              {editable && (
                <button type="button" className="ht-step" disabled={techIdx <= 0}
                  onClick={() => stepTech(-1)} aria-label="smaller die">−</button>
              )}
              <span className="text-ht-bright">{tech.current === 0 ? 'unusable' : `d${tech.current}`}</span>
              {editable && (
                <button type="button" className="ht-step" disabled={techIdx >= TECH_DIE_LADDER.length - 1}
                  onClick={() => stepTech(1)} aria-label="larger die">+</button>
              )}
            </span>
          </div>
          <div className="flex justify-between text-[9px] text-ht-muted">
            <span>base d{tech.base} · rolling a 1 shrinks it, rolling max grows it (until end of your next turn)</span>
            {editable && tech.overridden && tech.current !== tech.base && (
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setTechDie', sides: null })}>↺ base</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
