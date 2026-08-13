// apps/swdnd/src/panels/ShipSheet/Builder/steps/Equipment.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type {
  RefShipEquipment, ShipBuild, ShipEquipmentKind, ShipReferenceData,
} from '../../../../lib/shipRules/types';

/** starship_equipment kinds map onto the ship's single-slot systems. */
const SLOT_OF: Record<RefShipEquipment['kind'], ShipEquipmentKind | null> = {
  reactor: 'reactor', hyperdrive: 'hyperdrive', coupling: 'coupling', other: null,
};

export default function EquipmentStep({
  build, ref, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  const rows = Object.values(ref.equipment)
    .filter((r) => SLOT_OF[r.kind] !== null)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const entryFor = (r: RefShipEquipment) => build.equipment.find((e) => e.ref === r.id);

  return (
    <StepTable<RefShipEquipment>
      items={rows}
      columns={[
        { key: 'name', label: 'Equipment', flex: 2, value: (r) => r.name },
        { key: 'kind', label: 'Slot', value: (r) => r.kind },
        {
          key: 'spec', label: 'Spec',
          value: (r) =>
            r.kind === 'reactor' ? `power ${r.powerDiceRecovery ?? '—'}`
              : r.kind === 'hyperdrive' ? `class ${r.hyperdriveClass ?? '—'}`
                : `central ${r.centralCapacity ?? 0} / system ${r.systemCapacity ?? 0}`,
        },
        { key: 'price', label: 'Credits', value: (r) => r.price ?? 0 },
      ]}
      idOf={(r) => r.id}
      searchText={(r) => `${r.name} ${r.kind}`}
      detail={(r) => r.description || 'No description in the pack.'}
      isSelected={(r) => !!entryFor(r)}
      onSelect={(r) => {
        const entry = entryFor(r);
        if (entry) { dispatch({ t: 'removeEquipment', id: entry.id }); return; }
        const slot = SLOT_OF[r.kind];
        if (slot) dispatch({ t: 'installEquipment', ref: r.id, kind: slot });
      }}
      selectLabel={(r) => (entryFor(r) ? '✕ uninstall' : '✓ install')}
      editable={editable}
      header={
        <div className="ht-label px-1">
          Reactors, hyperdrives and power couplings — one of each. Power dice and coupling topology
          come online with the crew layer; the spine records the choice.
        </div>
      }
    />
  );
}
