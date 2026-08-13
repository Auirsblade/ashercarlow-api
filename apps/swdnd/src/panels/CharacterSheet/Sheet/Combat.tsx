// apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx
import { weaponAttacks } from '../../../lib/rules/weaponAttacks';
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../../../lib/rules/types';

export default function Combat({
  build,
  derived,
  ref,
  onRoll,
  onRollDamage,
}: {
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  onRoll: (label: string, mod: number) => void;
  onRollDamage: (label: string, formula: string) => void;
}) {
  const attacks = weaponAttacks(build, derived, ref);
  const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Attacks</div>
      {attacks.length === 0 && <div className="text-ht-muted">No weapons equipped.</div>}
      {attacks.map((a) => (
        <div key={a.id} className="flex w-full items-baseline gap-2">
          <span className="flex-1 truncate text-ht-text" title={`${a.ability.toUpperCase()} weapon`}>{a.name}</span>
          <button type="button" className="ht-step" title="roll to hit"
            onClick={() => onRoll(`${a.name} attack`, a.attackBonus)}>
            atk {fmt(a.attackBonus)}
          </button>
          {a.damageFormula && (
            <button type="button" className="ht-step" title={`roll ${a.damageType} damage`}
              onClick={() => onRollDamage(`${a.name} damage`, a.damageFormula)}>
              {a.damageFormula}
            </button>
          )}
        </div>
      ))}
      <div className="ht-label mb-1 mt-2">Defense</div>
      <div className="flex justify-between text-ht-text"><span>Armor Class</span><b>{derived.armorClass}</b></div>
      <div className="flex justify-between text-ht-text"><span>Initiative</span><b>{fmt(derived.initiative)}</b></div>
      <div className="flex justify-between text-ht-text"><span>Speed</span><b>{derived.speed}</b></div>
    </div>
  );
}
