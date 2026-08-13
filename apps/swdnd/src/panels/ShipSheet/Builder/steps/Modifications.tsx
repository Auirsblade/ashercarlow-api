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
  // All known modification names — a prerequisite outside this set is prose
  // ("Ship size Large or larger", "Weapon that deals energy damage", etc.)
  // and can never be satisfied by installing another modification.
  const modNames = new Set(Object.values(ref.modifications).map((m) => m.name));
  const unlocked = (build.houseRuled ?? []).includes('modifications');
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
      detail={(m) => {
        const base = m.description || 'No description in the pack.';
        // A prerequisite that isn't itself a known modification is prose
        // ("Ship size Large or larger", a weapon property, etc.) — it can never
        // be resolved by installing another mod, so surface it as information
        // in the detail pane instead of silently dropping it.
        return m.prerequisite && !modNames.has(m.prerequisite)
          ? `${base}\n— requires: ${m.prerequisite}`
          : base;
      }}
      isSelected={(m) => installed.has(m.id)}
      onSelect={(m) => dispatch({ t: 'toggleModification', ref: m.id })}
      // Only block when the prerequisite resolves to a real modification that
      // isn't installed — that's the one case a player can actually fix by
      // installing something else. Prose prerequisites (not in modNames) can
      // never be satisfied this way, so they're surfaced in the detail pane
      // instead of blocking (see `detail` above). One pack row (Carbonite
      // Launcher, Mk II) lists itself as its own prerequisite — it resolves
      // as "known" here and stays blocked, same as any unmet real prereq; the
      // ⌂ house-rule toggle for this step is the escape hatch for that (and
      // for any other budget/prereq warning), per the warn-don't-block spec.
      disabledReason={(m) =>
        !unlocked && !installed.has(m.id) && m.prerequisite && modNames.has(m.prerequisite) && !names.has(m.prerequisite)
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
