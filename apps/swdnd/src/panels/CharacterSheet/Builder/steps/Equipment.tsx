// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Equipment.tsx
import { useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

type Source = 'weapons' | 'armor' | 'gear';
interface Item { id: string; name: string; price: number | null; kind: string; description: string }

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function EquipmentStep({ build, ref, editable, dispatch }: Props) {
  const [source, setSource] = useState<Source>('weapons');
  const bg = ref.backgrounds[build.identity.backgroundId];
  const items: Item[] =
    source === 'weapons'
      ? Object.values(ref.weapons).map((w) => ({ id: w.id, name: w.name, price: w.price, kind: 'weapon', description: w.description }))
      : source === 'armor'
        ? Object.values(ref.armor).map((a) => ({ id: a.id, name: a.name, price: a.price, kind: a.kind, description: a.description }))
        : Object.values(ref.gear).map((g) => ({ id: g.id, name: g.name, price: g.price, kind: g.category ?? 'gear', description: g.description }));
  const qtyOf = (id: string) => build.equipment.find((e) => e.ref === id)?.qty ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[11px]">
        <span className="ht-label">Credits</span>
        {editable && <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setCredits', credits: build.credits - 50 })}>−50</button>}
        <b className="text-ht-bright">{build.credits.toLocaleString()} ₡</b>
        {editable && <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setCredits', credits: build.credits + 50 })}>+50</button>}
        <span className="ml-auto text-[10px] text-ht-muted">
          carried: {build.equipment.map((e) => `${e.qty > 1 ? `${e.qty}× ` : ''}${ref.weapons[e.ref]?.name ?? ref.armor[e.ref]?.name ?? ref.gear[e.ref]?.name ?? e.ref}`).join(', ') || 'nothing'}
        </span>
      </div>
      {bg?.equipmentProse && (
        <div className="ht-panel p-2 text-[10px] text-ht-muted">Background gear · {bg.equipmentProse}</div>
      )}
      <div className="flex gap-1 text-[11px]">
        {(['weapons', 'armor', 'gear'] as Source[]).map((s) => (
          <button key={s} type="button" onClick={() => setSource(s)}
            className={`flex-1 px-2 py-1 capitalize ${source === s ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}>
            {s}
          </button>
        ))}
      </div>
      <StepTable
        key={source}
        items={items}
        columns={[
          { key: 'name', label: 'Name', flex: 1.4, value: (i) => i.name },
          { key: 'kind', label: 'Type', flex: 0.8, value: (i) => i.kind },
          { key: 'price', label: 'Price ₡', flex: 0.6, value: (i) => i.price ?? 0 },
        ]}
        idOf={(i) => i.id}
        searchText={(i) => `${i.name} ${i.kind}`}
        isSelected={(i) => qtyOf(i.id) > 0}
        onSelect={(i) => dispatch({ t: 'addEquipment', ref: i.id })}
        selectLabel={(i) => (qtyOf(i.id) > 0 ? `+ add another (have ${qtyOf(i.id)})` : '✓ add to gear')}
        detail={(i) => (
          <span>
            {i.description || 'No description in the source data.'}
            {qtyOf(i.id) > 0 && editable && (
              <button type="button" className="ht-step ml-2" onClick={() => dispatch({ t: 'removeEquipment', ref: i.id })}>− remove one</button>
            )}
          </span>
        )}
        editable={editable}
      />
    </div>
  );
}
