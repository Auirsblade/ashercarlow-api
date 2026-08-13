// apps/swdnd/src/panels/ShipSheet/Builder/steps/Modifications.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type {
  DerivedShip, RefShipModification, ShipBuild, ShipReferenceData,
} from '../../../../lib/shipRules/types';

export default function ModificationsStep({
  build, ref, derived, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  derived: DerivedShip;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  const rows = Object.values(ref.modifications)
    .sort((a, b) => a.system.localeCompare(b.system) || a.grade - b.grade || a.name.localeCompare(b.name));
  const installed = new Set(build.modifications);
  const names = new Set(build.modifications.map((id) => ref.modifications[id]?.name).filter(Boolean));
  const slotsOver = derived.modSlotsUsed > derived.modSlotsMax;
  const suitesOver = derived.suitesUsed > derived.suitesMax;

  return (
    <StepTable<RefShipModification>
      items={rows}
      columns={[
        { key: 'name', label: 'Modification', flex: 2, value: (m) => m.name },
        { key: 'system', label: 'System', value: (m) => m.system },
        { key: 'grade', label: 'Grade', value: (m) => m.grade },
        { key: 'cost', label: 'Credits', value: (m) => m.baseCost ?? 0 },
      ]}
      idOf={(m) => m.id}
      searchText={(m) => `${m.name} ${m.system} grade ${m.grade}`}
      detail={(m) => m.description || 'No description in the pack.'}
      isSelected={(m) => installed.has(m.id)}
      onSelect={(m) => dispatch({ t: 'toggleModification', ref: m.id })}
      // Prerequisites are prose names in the pack; surface them as a warning
      // rather than a hard block — the table is house-rule friendly.
      disabledReason={(m) =>
        !installed.has(m.id) && m.prerequisite && !names.has(m.prerequisite)
          ? `requires ${m.prerequisite}`
          : null}
      editable={editable}
      header={
        <div className={`ht-label px-1 ${slotsOver || suitesOver ? 'text-yellow-300' : ''}`}>
          {derived.modSlotsUsed}/{derived.modSlotsMax} slots · suite {derived.suitesUsed}/{derived.suitesMax}
          {(slotsOver || suitesOver) && ' — over budget (⌂ to house-rule)'}
        </div>
      }
    />
  );
}
