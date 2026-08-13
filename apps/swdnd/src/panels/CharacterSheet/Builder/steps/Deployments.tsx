// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Deployments.tsx
import { useEffect, useMemo, useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import { deploymentsOf, prestigeOf } from '../../../../lib/rules/core';
import type { CharacterBuild } from '../../../../lib/rules/types';
import { loadDeploymentReference } from '../../../../lib/starships';
import type { DeploymentReferenceData, RefDeployment } from '../../../../lib/shipRules/types';
import StepTable from '../StepTable';

interface Props {
  build: CharacterBuild;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

const RANKS = [1, 2, 3, 4, 5];

export default function DeploymentsStep({ build, editable, dispatch }: Props) {
  // Two requests, on demand: deployments are optional content and must not
  // join the ten-request character reference loader.
  const [ref, setRef] = useState<DeploymentReferenceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadDeploymentReference()
      .then((r) => alive && setRef(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load deployments'));
    return () => { alive = false; };
  }, []);

  const rankById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of deploymentsOf(build)) map[d.deploymentId] = d.rank;
    return map;
  }, [build]);

  const featuresFor = (d: RefDeployment, rank: number) =>
    Object.values(ref?.deploymentFeatures ?? {})
      .filter((f) => f.role === d.role && f.rank > 0 && f.rank <= Math.max(rank, 1))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  if (error) return <div className="ht-panel p-2 font-mono text-[11px] text-red-300">⚠ {error}</div>;
  if (!ref) return <div className="ht-panel p-2 font-mono text-[11px] text-ht-muted">Loading deployments…</div>;

  const items = Object.values(ref.deployments).filter((d) => d.role !== null);
  const prestige = prestigeOf(build);
  // The reducer never validates deploymentId (Task 3 — no frontend catalog at
  // write time). If the build already carries a rank for an id this loaded
  // reference doesn't recognize (deleted/renamed content row, hand-edited
  // doc), it can't show up in the picker above. Surface it here instead of
  // letting it silently vanish, with a name fallback and a way to clear it.
  const orphaned = deploymentsOf(build).filter((d) => !ref.deployments[d.deploymentId]);

  return (
    <div className="flex flex-col gap-2">
      {orphaned.length > 0 && (
        <div className="ht-panel flex flex-col gap-1 p-2 text-[10px]">
          <span className="ht-label text-yellow-300">⚠ Unrecognized deployments</span>
          {orphaned.map((d) => (
            <div key={d.deploymentId} className="flex items-center justify-between gap-2">
              <span className="text-ht-muted">
                {d.deploymentId} <span className="text-yellow-300/80">(not in the loaded reference)</span> · rank {d.rank}
              </span>
              {editable && (
                <button type="button" className="ht-step"
                  onClick={() => dispatch({ t: 'setDeploymentRank', deploymentId: d.deploymentId, rank: 0 })}>
                  ✕ remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <StepTable
        items={items}
        columns={[
          { key: 'name', label: 'Deployment', flex: 1.2, value: (d) => d.name },
          { key: 'rank', label: 'Rank', flex: 0.6, value: (d) => rankById[d.id] ?? 0 },
        ]}
        idOf={(d) => d.id}
        searchText={(d) => `${d.name} ${d.role ?? ''}`}
        isSelected={(d) => (rankById[d.id] ?? 0) > 0}
        onSelect={(d) => dispatch({
          t: 'setDeploymentRank', deploymentId: d.id, rank: (rankById[d.id] ?? 0) > 0 ? 0 : 1,
        })}
        selectLabel={(d) => ((rankById[d.id] ?? 0) > 0 ? '✕ leave deployment' : '✓ deploy at rank 1')}
        detail={(d) => {
          const rank = rankById[d.id] ?? 0;
          return (
            <div className="flex flex-col gap-2">
              {editable && (
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="ht-label">Rank</span>
                  {[0, ...RANKS].map((r) => (
                    <button key={r} type="button"
                      className={`ht-step ${r === rank ? 'ht-tile-active' : ''}`}
                      onClick={() => dispatch({ t: 'setDeploymentRank', deploymentId: d.id, rank: r })}>
                      {r === 0 ? 'none' : r}
                    </button>
                  ))}
                </div>
              )}
              <div className="whitespace-pre-line">{d.description || 'No description in the source data.'}</div>
              <div>
                <div className="ht-label mb-1">Features {rank > 0 ? `· ranks 1–${rank}` : '· rank 1 preview'}</div>
                {featuresFor(d, rank).map((f) => (
                  <div key={f.id} className="flex justify-between gap-2 text-[10px]">
                    <span className="text-ht-text">{f.rank} · {f.name}</span>
                    <span className="text-ht-muted">
                      {f.powerSystem ? `${f.powerSystem} die` : '—'}{f.activation ? ` · ${f.activation}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        }}
        editable={editable}
        header={
          <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[10px]">
            <span className="ht-label">Prestige</span>
            {editable ? (
              <>
                <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setPrestige', prestige: prestige - 1 })}>−</button>
                <span className="text-ht-bright">{prestige}</span>
                <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setPrestige', prestige: prestige + 1 })}>+</button>
              </>
            ) : (
              <span className="text-ht-bright">{prestige}</span>
            )}
            <span className="ml-auto text-ht-muted">
              Deployments are optional. Rank sets which features you have; abilities are read at the table.
            </span>
          </div>
        }
      />
    </div>
  );
}
