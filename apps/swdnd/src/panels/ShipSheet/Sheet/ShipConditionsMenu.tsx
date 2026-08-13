// apps/swdnd/src/panels/ShipSheet/Sheet/ShipConditionsMenu.tsx
// Same interaction as CharacterSheet/Sheet/ConditionsMenu, over the SOTG ship
// condition vocabulary (levelled Slowed 1-4 included; the play reducer keeps
// only one level of a family at a time).
import { useState } from 'react';
import { shipConditionOptions } from '../../../lib/shipRules/constants';

interface Props {
  active: string[];
  editable: boolean;
  onAdd: (c: string) => void;
  onRemove: (c: string) => void;
}

export default function ShipConditionsMenu({ active, editable, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const available = shipConditionOptions().filter((c) => !active.includes(c));

  return (
    <div className="flex flex-wrap items-center justify-start gap-1.5 @lg:justify-end">
      {active.map((c) => (
        <button
          key={c}
          type="button"
          disabled={!editable}
          onClick={() => editable && onRemove(c)}
          className="ht-glow rounded-full px-2 py-0.5 text-[10px] text-ht-bright"
          title={editable ? 'Remove' : undefined}
        >
          ● {c}{editable && ' ✕'}
        </button>
      ))}
      {editable && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-full border border-ht-line px-2 py-0.5 text-[10px] text-ht-accent"
          >
            + Condition ▾
          </button>
          {open && (
            <div className="ht-panel absolute left-0 z-10 mt-1 max-h-56 w-44 overflow-auto p-1 text-[11px] @lg:left-auto @lg:right-0">
              {available.length === 0 && <div className="p-1 text-ht-muted">All applied</div>}
              {available.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-ht-text hover:bg-white/5"
                  onClick={() => { onAdd(c); setOpen(false); }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
