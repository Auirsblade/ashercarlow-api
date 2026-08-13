// apps/swdnd/src/panels/ShipSheet/Sheet/PoolBar.tsx
// A labelled pool with a filled track, a stepper, its dice pool, and one
// optional one-tap action (Regenerate / Patch).
import Stepper from '../../CharacterSheet/Sheet/Stepper';

interface Props {
  label: string;
  value: number;
  max: number;
  tone: 'shields' | 'hull';
  editable: boolean;
  diceLabel: string;
  diceRemaining: number;
  diceMax: number;
  onDelta: (d: number) => void;
  onSet: (v: number) => void;
  onSpendDie: () => void;
  onRegainDie: () => void;
  action?: { label: string; title: string; onClick: () => void };
}

const TRACK: Record<Props['tone'], string> = {
  shields: 'bg-sky-400/70',
  hull: 'bg-amber-400/70',
};

export default function PoolBar({
  label, value, max, tone, editable, diceLabel, diceRemaining, diceMax,
  onDelta, onSet, onSpendDie, onRegainDie, action,
}: Props) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="ht-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="ht-label min-w-[64px]">{label}</span>
        <Stepper value={value} max={max} editable={editable} onDelta={onDelta} onSet={onSet} />
        {action && (
          <button type="button" className="ht-step ml-auto text-[10px]" disabled={!editable || diceRemaining <= 0}
            title={action.title} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/10">
        <div className={`h-full ${TRACK[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-ht-muted">
        <span>{diceLabel} {diceRemaining}/{diceMax}</span>
        {editable && (
          <span>
            <button type="button" className="ht-step" title="spend one die" onClick={onSpendDie}>−</button>
            <button type="button" className="ht-step" title="regain one die" onClick={onRegainDie}>+</button>
          </span>
        )}
      </div>
    </div>
  );
}
