// apps/swdnd/src/panels/CharacterSheet/Sheet/Abilities.tsx
import type { AbilityKey, DerivedSheet } from '../../../lib/rules/types';

const ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export default function Abilities({
  derived,
  onRoll,
}: {
  derived: DerivedSheet;
  onRoll: (label: string, mod: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ORDER.map((key) => {
        const a = derived.abilities[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => onRoll(key.toUpperCase() + ' check', a.mod)}
            className="ht-panel px-2 py-2 text-center font-mono"
          >
            <div className="ht-label">{key}</div>
            <b className="text-ht-bright">{a.score}</b>
            <div className="text-ht-muted">{a.mod >= 0 ? `+${a.mod}` : a.mod}</div>
          </button>
        );
      })}
    </div>
  );
}
