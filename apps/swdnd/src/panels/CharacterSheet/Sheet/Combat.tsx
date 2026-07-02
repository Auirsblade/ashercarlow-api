// apps/swdnd/src/panels/CharacterSheet/Sheet/Combat.tsx
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../../../lib/rules/types';

export default function Combat({
  build,
  derived,
  ref,
  onRoll,
}: {
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  onRoll: (label: string, mod: number) => void;
}) {
  const weapons = build.equipment
    .filter((e) => e.equipped)
    .map((e) => ref.weapons[e.ref])
    .filter(Boolean);
  const atkMod = derived.proficiencyBonus + derived.abilities.str.mod;
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Attacks</div>
      {weapons.length === 0 && <div className="text-ht-muted">No weapons equipped.</div>}
      {weapons.map((w) => (
        <button key={w.id} type="button" onClick={() => onRoll(`${w.name} attack`, atkMod)}
          className="flex w-full justify-between text-ht-text">
          <span>{w.name}</span>
          <span className="text-ht-muted">atk {atkMod >= 0 ? `+${atkMod}` : atkMod}</span>
        </button>
      ))}
      <div className="ht-label mb-1 mt-2">Defense</div>
      <div className="flex justify-between text-ht-text"><span>Armor Class</span><b>{derived.armorClass}</b></div>
      <div className="flex justify-between text-ht-text"><span>Initiative</span><b>+{derived.initiative}</b></div>
      <div className="flex justify-between text-ht-text"><span>Speed</span><b>{derived.speed}</b></div>
    </div>
  );
}
