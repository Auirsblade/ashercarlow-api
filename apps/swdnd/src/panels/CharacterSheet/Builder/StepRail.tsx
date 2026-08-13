// apps/swdnd/src/panels/CharacterSheet/Builder/StepRail.tsx
import { STEP_ORDER, type StepInfo, type StepKey } from '../../../lib/validation';

const LABELS: Record<StepKey, string> = {
  species: 'Species', background: 'Background', class: 'Class', abilities: 'Abilities',
  skills: 'Skills', feats: 'Feats', equipment: 'Equipment', powers: 'Powers', deployments: 'Deployments',
};
const GLYPH = { done: '✓', attention: '!', untouched: '○' } as const;
const GLYPH_CLASS = { done: 'text-green-300', attention: 'text-yellow-300', untouched: 'text-ht-muted' } as const;

interface Props {
  status: Record<StepKey, StepInfo>;
  active: StepKey;
  houseRuled: string[];
  onSelect: (step: StepKey) => void;
}

export default function StepRail({ status, active, houseRuled, onSelect }: Props) {
  const steps = STEP_ORDER.filter((k) => status[k].applicable);
  const remaining = steps.filter((k) => status[k].state !== 'done').length;
  return (
    <nav className="flex shrink-0 flex-col gap-1 @lg:min-w-[190px]">
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
        {remaining === 0 ? '✓ all steps complete' : `${remaining} step${remaining === 1 ? '' : 's'} remaining`}
      </div>
    </nav>
  );
}
