// apps/swdnd/src/panels/CharacterSheet/Sheet/Features.tsx
import type { CharacterBuild } from '../../../lib/rules/types';

export default function Features({ build }: { build: CharacterBuild }) {
  const classes = [...new Set(build.levels.map((l) => l.classId))];
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Features &amp; Traits</div>
      <div className="flex justify-between text-ht-text">
        <span>Species</span><span className="text-ht-muted">{build.identity.speciesId || '—'}</span>
      </div>
      <div className="flex justify-between text-ht-text">
        <span>Background</span><span className="text-ht-muted">{build.identity.backgroundId || '—'}</span>
      </div>
      <div className="flex justify-between text-ht-text">
        <span>Classes</span><span className="text-ht-muted">{classes.join(', ') || '—'}</span>
      </div>
      <div className="mt-1 text-ht-muted">Feature detail arrives with the builder (Phase 3).</div>
    </div>
  );
}
