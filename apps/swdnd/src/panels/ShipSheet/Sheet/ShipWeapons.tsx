// apps/swdnd/src/panels/ShipSheet/Sheet/ShipWeapons.tsx
import type { ShipPlayAction } from '../../../lib/shipPlayState';
import type { DerivedShip, ShipPlayState } from '../../../lib/shipRules/types';

const MOUNT_LABEL: Record<string, string> = {
  'fixed-forward': 'fwd', 'fixed-aft': 'aft', 'fixed-port': 'port',
  'fixed-starboard': 'stbd', turret: 'turret',
};

export default function ShipWeapons({
  derived, play, editable, dispatch, onRoll, onRollDamage,
}: {
  derived: DerivedShip;
  play: ShipPlayState;
  editable: boolean;
  dispatch: (a: ShipPlayAction) => void;
  onRoll: (label: string, mod: number) => void;
  onRollDamage: (label: string, formula: string) => void;
}) {
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Weapons — {derived.rateOfFireCap} per round</div>
      {derived.weapons.length === 0 && <div className="text-ht-muted">No weapons installed.</div>}
      {derived.weapons.map((w) => {
        const spent = play.ammoSpent[w.entryId] ?? 0;
        return (
          <div key={w.entryId} className="flex flex-wrap items-baseline gap-2 border-b border-ht-line/40 py-1 last:border-0">
            <span className="min-w-[130px] flex-1 truncate text-ht-text" title={`${w.category} · ${MOUNT_LABEL[w.mount] ?? w.mount}`}>
              {w.name}
            </span>
            {w.saveDc == null ? (
              <button type="button" className="ht-step" title="roll to hit (add your own proficiency)"
                onClick={() => onRoll(`${w.name} attack`, w.attackShipMod)}>
                {/* The ship supplies WIS; the gunner's proficiency is a crew stat
                    the spine does not know — hence the literal suffix. */}
                {w.attackText}
              </button>
            ) : (
              <span className="text-ht-muted">DC {w.saveDc} {w.saveAbility.toUpperCase()}</span>
            )}
            {w.damageFormula && (
              <button type="button" className="ht-step" title={`roll ${w.damageType} damage`}
                onClick={() => onRollDamage(`${w.name} damage`, w.damageFormula)}>
                {w.damageFormula}
              </button>
            )}
            {w.rangeNormal != null && (
              <span className="text-[10px] text-ht-muted">{w.rangeNormal}{w.rangeLong ? `/${w.rangeLong}` : ''} ft</span>
            )}
            {w.usesAmmo && (
              <span className="flex items-center gap-1 text-[10px] text-ht-muted">
                ammo −{spent}
                {editable && (
                  <>
                    <button type="button" className="ht-step" title="fire one"
                      onClick={() => dispatch({ t: 'spendAmmo', entryId: w.entryId, n: 1 })}>−</button>
                    <button type="button" className="ht-step" title="reload"
                      onClick={() => dispatch({ t: 'reloadAmmo', entryId: w.entryId })}>⟳</button>
                  </>
                )}
                {w.reload != null && <span>cap {w.reload}</span>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
