// apps/swdnd/src/panels/CharacterSheet/Sheet/Skills.tsx
import { SKILLS } from '../../../lib/rules/constants';
import type { AbilityKey, DerivedSheet } from '../../../lib/rules/types';

const ABIL_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export default function Skills({
  derived,
  onRoll,
}: {
  derived: DerivedSheet;
  onRoll: (label: string, mod: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 font-mono text-[11px]">
      <div className="ht-panel p-2">
        <div className="ht-label mb-1">Saving Throws</div>
        {ABIL_ORDER.map((k) => {
          const s = derived.savingThrows[k];
          return (
            <button key={k} type="button" onClick={() => onRoll(k.toUpperCase() + ' save', s.bonus)}
              className={`flex w-full justify-between ${s.proficient ? 'text-ht-bright' : 'text-ht-muted'}`}>
              <span>{s.proficient ? '● ' : ''}{k.toUpperCase()}</span>
              <b>{fmt(s.bonus)}</b>
            </button>
          );
        })}
      </div>
      <div className="ht-panel p-2">
        <div className="ht-label mb-1">Skills</div>
        {derived.skills.map((sk) => (
          <button key={sk.key} type="button" onClick={() => onRoll(SKILLS[sk.key].label, sk.bonus)}
            className={`flex w-full justify-between ${sk.proficient ? 'text-ht-bright' : 'text-ht-muted'}`}>
            <span>{sk.expertise ? '◎ ' : sk.proficient ? '● ' : ''}{SKILLS[sk.key].label} <span className="text-ht-muted">({sk.ability})</span></span>
            <b>{fmt(sk.bonus)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}
