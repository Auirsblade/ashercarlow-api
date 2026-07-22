// apps/swdnd/src/panels/CharacterSheet/Sheet/Abilities.tsx
import type { AbilityKey, DerivedSheet } from '../../../lib/rules/types';

const ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

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
        const save = derived.savingThrows[key];
        const active = key === highlight;
        return (
          <div key={key} className={`ht-panel flex flex-col text-center font-mono${active ? ' ht-tile-active' : ''}`}>
            <button
              type="button"
              onClick={() => onRoll(key.toUpperCase() + ' check', a.mod)}
              className="px-2 pt-2"
            >
              <div className="ht-label">{key}</div>
              <b className="text-ht-bright">{a.score}</b>
              <div className={active ? 'text-ht-bright' : 'text-ht-muted'}>{fmt(a.mod)}</div>
            </button>
            <button
              type="button"
              onClick={() => onRoll(key.toUpperCase() + ' save', save.bonus)}
              className={`mt-1 border-t border-ht-line px-2 py-0.5 text-[10px] ${
                save.proficient ? 'text-ht-bright' : 'text-ht-muted'
              }`}
            >
              {save.proficient ? '● ' : ''}save {fmt(save.bonus)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
