// apps/swdnd/src/panels/ShipSheet/Builder/steps/Size.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type { RefShipSize, ShipBuild, ShipReferenceData } from '../../../../lib/shipRules/types';

export default function SizeStep({
  build, ref, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  const sizes = Object.values(ref.sizes).sort((a, b) => a.hullDie - b.hullDie);
  return (
    <StepTable<RefShipSize>
      items={sizes}
      columns={[
        { key: 'name', label: 'Chassis', flex: 2, value: (s) => s.name },
        { key: 'hull', label: 'Hull', value: (s) => `${s.hullDiceStart}d${s.hullDie}` },
        { key: 'speed', label: 'Turn', value: (s) => s.turnSpeed },
        { key: 'hardpoints', label: 'HP mult', value: (s) => s.hardpointMult },
      ]}
      idOf={(s) => s.id}
      searchText={(s) => `${s.name} ${s.key}`}
      detail={(s) => s.description || 'No description in the pack.'}
      isSelected={(s) => s.id === build.identity.sizeId}
      onSelect={(s) => dispatch({ t: 'setSize', sizeId: s.id })}
      selectLabel={(s) => (s.id === build.identity.sizeId ? '◈ selected' : '✓ select chassis')}
      editable={editable}
      header={
        <div className="ht-label px-1">
          The chassis fixes hull and shield dice, base speeds, and the hardpoint / suite budgets.
          Changing it re-scales the ship's current hull and shields.
        </div>
      }
    />
  );
}
