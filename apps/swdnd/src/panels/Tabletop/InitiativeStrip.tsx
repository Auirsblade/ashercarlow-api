// apps/swdnd/src/panels/Tabletop/InitiativeStrip.tsx
import type { Initiative } from '../../lib/initiative';

export default function InitiativeStrip({
  initiative, isDm, nameOf, onNext, onPrev, onEnd,
}: {
  initiative: Initiative;
  isDm: boolean;
  /** Resolve a nested crew token id to a display name. */
  nameOf: (tokenId: string) => string;
  onNext: () => void;
  onPrev: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="ht-panel mx-2 mb-2 flex flex-wrap items-center gap-2 p-2 text-[11px]">
      <span className="ht-label">Round {initiative.round}</span>
      {initiative.order.map((e, i) => (
        <span
          key={e.tokenId}
          className={`ht-step ${i === initiative.activeIndex ? 'ht-tile-active' : ''}`}
        >
          {e.name} <span className="text-ht-muted">{e.roll}</span>
          {e.crew?.length ? (
            <span className="text-ht-muted"> ⟨{e.crew.map(nameOf).join(', ')}⟩</span>
          ) : null}
        </span>
      ))}
      {initiative.order.length === 0 && <span className="text-[10px] text-ht-muted">no combatants</span>}
      {isDm && (
        <span className="ml-auto flex items-center gap-2">
          <button type="button" title="back one turn" className="ht-step" onClick={onPrev}>◀</button>
          <button type="button" title="advance to the next turn" className="ht-step" onClick={onNext}>▶ next</button>
          <button type="button" title="end combat and clear the tracker" className="ht-step text-red-400" onClick={onEnd}>end</button>
        </span>
      )}
    </div>
  );
}
