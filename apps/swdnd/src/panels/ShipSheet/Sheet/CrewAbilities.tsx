// apps/swdnd/src/panels/ShipSheet/Sheet/CrewAbilities.tsx
import type { CharacterDto } from '../../../lib/characters';
import { deploymentRankForRole } from '../../../lib/crew';
import type { ShipReferenceData, ShipRole } from '../../../lib/shipRules/types';

interface Props {
  crewMembers: Array<{ role: ShipRole; dto: CharacterDto }>;
  ref: ShipReferenceData;
}

/** Rank-gated deployment abilities as reference text — no buttons, nothing automated. */
export default function CrewAbilities({ crewMembers, ref }: Props) {
  if (crewMembers.length === 0) return null;
  const features = Object.values(ref.deploymentFeatures);

  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Crew abilities</div>
      {crewMembers.map((m) => {
        const rank = deploymentRankForRole(m.dto.data_json, m.role, ref.deployments);
        const list = features
          .filter((f) => f.role === m.role && f.rank > 0 && f.rank <= rank)
          .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
        return (
          <div key={`${m.dto.id}:${m.role}`} className="mt-1 border-t border-ht-line pt-1">
            <div className="flex justify-between text-ht-text">
              <span>{m.dto.name} · {m.role}</span>
              <span className="text-ht-muted">{rank > 0 ? `rank ${rank}` : 'not deployed'}</span>
            </div>
            {rank === 0 && (
              <div className="text-[10px] text-ht-muted">
                No rank in this deployment — contributes no proficiency to the ship.
              </div>
            )}
            {list.map((f) => (
              <div key={f.id} className="mt-0.5">
                <div className="flex justify-between gap-2 text-[10px] text-ht-muted">
                  <span>{f.rank} · {f.name}</span>
                  <span>{f.powerSystem ? `${f.powerSystem} die` : ''}{f.activation ? ` · ${f.activation}` : ''}</span>
                </div>
                {f.description && (
                  <div className="whitespace-pre-line pl-3 text-[10px] text-ht-muted/80">{f.description}</div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
