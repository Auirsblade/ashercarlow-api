// apps/swdnd/src/panels/ShipSheet/Builder/ShipStepRail.tsx
// Same shell as the character StepRail — the rail is kept for consistency even
// though ship validation is budget-based rather than sequential.
import { SHIP_STEP_ORDER, type ShipStepKey } from '../../../lib/shipValidation';
import type { StepInfo } from '../../../lib/validation';

const LABELS: Record<ShipStepKey, string> = {
  size: 'Size', tier: 'Tier', hull: 'Hull & Shields',
  weapons: 'Weapons', equipment: 'Equipment', modifications: 'Modifications',
};
const GLYPH = { done: '✓', attention: '!', untouched: '○' } as const;
const GLYPH_CLASS = { done: 'text-green-300', attention: 'text-yellow-300', untouched: 'text-ht-muted' } as const;

interface Props {
  status: Record<ShipStepKey, StepInfo>;
  active: ShipStepKey;
  houseRuled: string[];
  onSelect: (step: ShipStepKey) => void;
}

export default function ShipStepRail({ status, active, houseRuled, onSelect }: Props) {
  const steps = SHIP_STEP_ORDER.filter((k) => status[k].applicable);
  const overBudget = steps.filter((k) => status[k].state === 'attention').length;
  return (
    <nav className="flex shrink-0 flex-col gap-1 @lg:min-w-[210px]">
      <div className="flex gap-1 overflow-x-auto @lg:flex-col @lg:overflow-visible">
        {steps.map((k) => {
          const s = status[k];
          const isActive = k === active;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelect(k)}
              className={`flex shrink-0 items-center gap-2 px-2 py-1 text-left text-[11px] ${
                isActive ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'
              }`}
            >
              <span className={GLYPH_CLASS[s.state]}>{GLYPH[s.state]}</span>
              <span>{LABELS[k]}</span>
              {houseRuled.includes(k) && <span title="house-ruled">⌂</span>}
              <span className="ml-auto pl-2 text-[9px] text-ht-muted">{s.summary}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 hidden text-[10px] text-ht-muted @lg:block">
        {overBudget === 0 ? '✓ within every budget' : `${overBudget} step${overBudget === 1 ? '' : 's'} over budget`}
      </div>
    </nav>
  );
}
