// apps/swdnd/src/panels/CharacterSheet/Sheet/Stepper.tsx
import { useState } from 'react';

interface StepperProps {
  value: number;
  max?: number;
  editable: boolean;
  onDelta: (delta: number) => void;
  onSet?: (value: number) => void;
}

/** Inline −/+ with tap-to-type. Renders "value/max" when max is given. */
export default function Stepper({ value, max, editable, onDelta, onSet }: StepperProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!editable) {
    return (
      <span className="font-mono text-ht-bright">
        {value}
        {max != null && <span className="text-ht-muted">/{max}</span>}
      </span>
    );
  }

  const commit = () => {
    const n = Number(draft);
    if (onSet && Number.isFinite(n)) onSet(n);
    setEditing(false);
  };

  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      <button type="button" className="ht-step" onClick={() => onDelta(-1)} aria-label="decrement">−</button>
      {editing ? (
        <input
          autoFocus
          className="w-10 bg-transparent text-center text-ht-bright outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      ) : (
        <button
          type="button"
          className="text-lg text-ht-bright"
          onClick={() => {
            if (!onSet) return;
            setDraft(String(value));
            setEditing(true);
          }}
        >
          {value}
        </button>
      )}
      {max != null && <span className="text-ht-muted">/{max}</span>}
      <button type="button" className="ht-step" onClick={() => onDelta(1)} aria-label="increment">+</button>
    </span>
  );
}
