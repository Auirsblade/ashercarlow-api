// apps/swdnd/src/panels/CharacterSheet/Sheet/ConditionsMenu.tsx
import { useState } from 'react';

export const SW5E_CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated',
  'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained',
  'Shocked', 'Slowed', 'Stunned', 'Unconscious',
];

interface Props {
  active: string[];
  editable: boolean;
  onAdd: (c: string) => void;
  onRemove: (c: string) => void;
}

export default function ConditionsMenu({ active, editable, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const available = SW5E_CONDITIONS.filter((c) => !active.includes(c));

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
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
            <div className="absolute right-0 z-10 mt-1 max-h-56 w-40 overflow-auto ht-panel p-1 text-[11px]">
              {available.length === 0 && <div className="p-1 text-ht-muted">All applied</div>}
              {available.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-ht-text hover:bg-white/5"
                  onClick={() => {
                    onAdd(c);
                    setOpen(false);
                  }}
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
