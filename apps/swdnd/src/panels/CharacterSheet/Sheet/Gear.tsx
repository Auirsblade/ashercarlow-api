// apps/swdnd/src/panels/CharacterSheet/Sheet/Gear.tsx
import type { CharacterBuild, ReferenceData } from '../../../lib/rules/types';

export default function Gear({ build, ref }: { build: CharacterBuild; ref: ReferenceData }) {
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">
        Gear · <span className="text-ht-bright">{build.credits.toLocaleString()} ₡</span>
      </div>
      {build.equipment.length === 0 && <div className="text-ht-muted">Nothing carried.</div>}
      {build.equipment.map((e, i) => {
        const item = ref.weapons[e.ref] ?? ref.armor[e.ref];
        return (
          <div key={`${e.ref}-${i}`} className="flex justify-between text-ht-text">
            <span>{e.equipped ? '◈ ' : '· '}{item?.name ?? e.ref}{e.qty > 1 ? ` ×${e.qty}` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}
