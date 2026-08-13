// apps/swdnd/src/panels/ShipSheet/Builder/steps/Weapons.tsx
import StepTable from '../../../CharacterSheet/Builder/StepTable';
import { WEAPON_MOUNTS } from '../../../../lib/shipRules/constants';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type {
  DerivedShip, RefShipWeapon, ShipBuild, ShipReferenceData, WeaponMount,
} from '../../../../lib/shipRules/types';

const MOUNT_LABEL: Record<WeaponMount, string> = {
  'fixed-forward': 'fwd', 'fixed-aft': 'aft', 'fixed-port': 'port',
  'fixed-starboard': 'stbd', turret: 'turret',
};

export default function WeaponsStep({
  build, ref, derived, editable, dispatch,
}: {
  build: ShipBuild;
  ref: ShipReferenceData;
  derived: DerivedShip;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  // 'other' covers the pack's `ammo` and `simpleVW` rows — not installable weapons.
  const rows = Object.values(ref.weapons)
    .filter((w) => w.category !== 'other')
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const over = derived.hardpointsUsed > derived.hardpointsMax;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="ht-panel p-2 text-[11px]">
        <div className={`ht-label mb-1 ${over ? 'text-yellow-300' : ''}`}>
          {derived.hardpointsUsed}/{derived.hardpointsMax} hardpoints
          {over && ' — over budget (⌂ to house-rule)'} · rate of fire {derived.rateOfFireCap}/round
        </div>
        {derived.weapons.length === 0 && <div className="text-ht-muted">Nothing installed.</div>}
        {derived.weapons.map((p) => (
          <div key={p.entryId} className="flex flex-wrap items-center gap-2 py-0.5">
            <span className="min-w-[140px] text-ht-text">{p.name}</span>
            <span className="text-[10px] text-ht-muted">{p.category}</span>
            <span className="flex gap-1">
              {WEAPON_MOUNTS.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!editable}
                  className={`ht-step text-[10px] ${p.mount === m ? 'ht-tile-active' : ''}`}
                  onClick={() => dispatch({ t: 'setMount', id: p.entryId, mount: m })}
                >
                  {MOUNT_LABEL[m]}
                </button>
              ))}
            </span>
            <span className="text-[10px] text-ht-muted">{p.attackText} · {p.damageFormula || '—'}</span>
            {editable && (
              <button type="button" className="ht-step ml-auto text-red-400"
                onClick={() => dispatch({ t: 'removeEquipment', id: p.entryId })}>✕</button>
            )}
          </div>
        ))}
      </div>

      <StepTable<RefShipWeapon>
        items={rows}
        columns={[
          { key: 'name', label: 'Weapon', flex: 2, value: (w) => w.name },
          { key: 'category', label: 'Class', value: (w) => w.category },
          { key: 'damage', label: 'Damage', value: (w) => w.damageParts[0]?.[0] ?? '—' },
          { key: 'range', label: 'Range', value: (w) => w.rangeNormal ?? 0 },
        ]}
        idOf={(w) => w.id}
        searchText={(w) => `${w.name} ${w.category} ${w.damageParts[0]?.[1] ?? ''}`}
        detail={(w) => w.description || 'No description in the pack.'}
        // Weapons stack: several hardpoints may hold the same model, so a row is
        // "selected" when at least one entry references it, and select always adds.
        isSelected={(w) => build.equipment.some((e) => e.kind === 'weapon' && e.ref === w.id)}
        onSelect={(w) => dispatch({ t: 'installEquipment', ref: w.id, kind: 'weapon', mount: 'fixed-forward' })}
        selectLabel={() => '✓ install on a hardpoint'}
        editable={editable}
      />
    </div>
  );
}
