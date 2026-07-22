// apps/swdnd/src/panels/CharacterSheet/Sheet/Skills.tsx
import { SKILLS } from '../../../lib/rules/constants';
import type { DerivedSheet } from '../../../lib/rules/types';

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

// Saving throws live inside the Abilities tiles; this panel is skills only.
export default function Skills({
  derived,
  onRoll,
}: {
  derived: DerivedSheet;
  onRoll: (label: string, mod: number) => void;
}) {
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Skills</div>
      {derived.skills.map((sk) => (
        <button key={sk.key} type="button" onClick={() => onRoll(SKILLS[sk.key].label, sk.bonus)}
          className={`flex w-full justify-between ${sk.proficient ? 'text-ht-bright' : 'text-ht-muted'}`}>
          <span>{sk.expertise ? '◎ ' : sk.proficient ? '● ' : ''}{SKILLS[sk.key].label} <span className="text-ht-muted">({sk.ability})</span></span>
          <b>{fmt(sk.bonus)}</b>
        </button>
      ))}
    </div>
  );
}
