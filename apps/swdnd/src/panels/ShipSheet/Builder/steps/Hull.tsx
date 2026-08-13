// apps/swdnd/src/panels/ShipSheet/Builder/steps/Hull.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import { installedArmor, installedShield } from '../../../../lib/shipRules/defense';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type { DerivedShip, RefShipArmor, ShipBuild, ShipReferenceData } from '../../../../lib/shipRules/types';

export default function HullStep({
  build, ref, derived, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  derived: DerivedShip;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  // starship_armor holds hull armor AND shield generators; show both, tagged.
  const rows = Object.values(ref.armor).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const armor = installedArmor(build, ref);
  const shield = installedShield(build, ref);
  const selectedId = (r: RefShipArmor) => (r.kind === 'shield' ? shield?.id : armor?.id);

  return (
    <StepTable<RefShipArmor>
      items={rows}
      columns={[
        { key: 'name', label: 'System', flex: 2, value: (r) => r.name },
        { key: 'kind', label: 'Slot', value: (r) => (r.kind === 'shield' ? 'shields' : 'armor') },
        {
          key: 'effect', label: 'Effect',
          value: (r) => (r.kind === 'shield'
            ? `cap ×${r.capacityCoefficient ?? 1} · regen ×${r.regenCoefficient ?? 1}`
            : `DR ${r.damageReduction} · dex ${r.dexCap == null ? '—' : `+${r.dexCap}`}`),
        },
        { key: 'price', label: 'Credits', value: (r) => r.price ?? 0 },
      ]}
      idOf={(r) => r.id}
      searchText={(r) => `${r.name} ${r.kind}`}
      detail={(r) => r.description || 'No description in the pack.'}
      isSelected={(r) => r.id === selectedId(r)}
      onSelect={(r) =>
        r.id === selectedId(r)
          ? dispatch({ t: 'removeEquipment', id: build.equipment.find((e) => e.ref === r.id)?.id ?? '' })
          : dispatch({ t: 'installEquipment', ref: r.id, kind: r.kind === 'shield' ? 'shield' : 'armor' })}
      selectLabel={(r) => (r.id === selectedId(r) ? '✕ uninstall' : '✓ install')}
      editable={editable}
      header={
        <div className="ht-label px-1">
          hull {derived.maxHull} ({derived.hullDice.count}d{derived.hullDice.die} + CON/die) ·{' '}
          shields {derived.maxShields}
          {derived.maxShields === 0 && ' — install a shield generator'} ·{' '}
          regen {derived.shieldRegen} · AC {derived.armorClass} · DR {derived.damageReduction}
        </div>
      }
    />
  );
}
