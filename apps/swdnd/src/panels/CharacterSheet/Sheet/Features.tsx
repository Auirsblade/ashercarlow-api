// apps/swdnd/src/panels/CharacterSheet/Sheet/Features.tsx
import { classesTaken } from '../../../lib/rules/core';
import type { CharacterBuild, ReferenceData } from '../../../lib/rules/types';
import { classSummary } from '../../../lib/sheetView';

export default function Features({ build, ref }: { build: CharacterBuild; ref: ReferenceData }) {
  const speciesName = ref.species[build.identity.speciesId]?.name ?? build.identity.speciesId;
  const backgroundName = ref.backgrounds[build.identity.backgroundId]?.name ?? build.identity.backgroundId;
  const archetyped = classesTaken(build).filter((t) => t.archetypeId);
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Features &amp; Traits</div>
      <div className="flex justify-between text-ht-text">
        <span>Species</span><span className="text-ht-muted">{speciesName || '—'}</span>
      </div>
      <div className="flex justify-between text-ht-text">
        <span>Background</span><span className="text-ht-muted">{backgroundName || '—'}</span>
      </div>
      <div className="flex justify-between text-ht-text">
        <span>Classes</span><span className="text-ht-muted">{classSummary(build, ref) || '—'}</span>
      </div>
      {archetyped.map((t) => (
        <div key={t.classId} className="flex justify-between text-ht-text">
          <span>{ref.classes[t.classId]?.name ?? t.classId} archetype</span>
          <span className="text-ht-muted">{ref.archetypes[t.archetypeId!]?.name ?? t.archetypeId}</span>
        </div>
      ))}
    </div>
  );
}
