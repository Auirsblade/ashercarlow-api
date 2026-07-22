// apps/swdnd/src/panels/CharacterSheet/Sheet/Abilities.tsx
import type { AbilityKey, DerivedSheet } from '../../../lib/rules/types';

const ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export default function Abilities({
  derived,
  highlight,
  onRoll,
}: {
  derived: DerivedSheet;
  /** The active casting ability — rendered with the faction glow. */
  highlight?: AbilityKey | null;
  onRoll: (label: string, mod: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ORDER.map((key) => {
        const a = derived.abilities[key];
        const active = key === highlight;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onRoll(key.toUpperCase() + ' check', a.mod)}
            className={`ht-panel px-2 py-2 text-center font-mono${active ? ' ht-tile-active' : ''}`}
          >
            <div className="ht-label">{key}</div>
            <b className="text-ht-bright">{a.score}</b>
            <div className={active ? 'text-ht-bright' : 'text-ht-muted'}>{a.mod >= 0 ? `+${a.mod}` : a.mod}</div>
          </button>
        );
      })}
    </div>
  );
}
