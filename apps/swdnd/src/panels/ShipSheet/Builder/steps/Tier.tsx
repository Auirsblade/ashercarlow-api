// apps/swdnd/src/panels/ShipSheet/Builder/steps/Tier.tsx
import { MAX_SHIP_TIER, SHIP_ABILITIES } from '../../../../lib/shipRules/constants';
import type { ShipBuildAction } from '../../../../lib/shipBuildState';
import type { DerivedShip, ShipAbilityKey, ShipBuild } from '../../../../lib/shipRules/types';

const LABEL: Record<ShipAbilityKey, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};
const TIER_POINT_BUDGET = 2;
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export default function TierStep({
  build, derived, editable, dispatch,
}: {
  build: ShipBuild;
  derived: DerivedShip;
  editable: boolean;
  dispatch: (a: ShipBuildAction) => void;
}) {
  const tiers = Array.from({ length: MAX_SHIP_TIER }, (_, i) => i + 1);
  const spentAt = (tier: number) =>
    build.abilities.increases.filter((i) => i.ref === `t${tier}`).reduce((s, i) => s + i.amount, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-[11px]">
      <div className="ht-panel flex flex-wrap items-center gap-2 p-2">
        <span className="ht-label">Tier</span>
        {[0, ...tiers].map((t) => (
          <button
            key={t}
            type="button"
            disabled={!editable}
            className={`ht-step ${t === derived.tier ? 'ht-tile-active' : ''}`}
            onClick={() => dispatch({ t: 'setTier', tier: t })}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-ht-muted">
          AC {derived.armorClass} · hull {derived.hullDice.count}d{derived.hullDice.die} · {derived.modSlotsMax} mod slots
        </span>
      </div>

      <div className="ht-panel p-2">
        <div className="ht-label mb-1">Base ability scores</div>
        <div className="flex flex-wrap gap-3">
          {SHIP_ABILITIES.map((k) => (
            <label key={k} className="flex items-center gap-1">
              <span className="text-ht-muted">{LABEL[k]}</span>
              <input
                type="number"
                disabled={!editable}
                className="w-14 border-b border-ht-line bg-transparent text-center text-ht-bright outline-none"
                value={build.abilities.base[k]}
                onChange={(e) =>
                  dispatch({
                    t: 'setBaseAbilities',
                    base: { ...build.abilities.base, [k]: Number(e.target.value) || 0 },
                  })}
              />
              <b className="text-ht-bright">{fmt(derived.abilities[k].mod)}</b>
            </label>
          ))}
        </div>
      </div>

      {tiers
        .filter((t) => t <= derived.tier)
        .map((t) => {
          const spent = spentAt(t);
          return (
            <div key={t} className="ht-panel p-2">
              <div className="ht-label mb-1">
                Tier {t} ability points — {TIER_POINT_BUDGET - spent} of {TIER_POINT_BUDGET} left
              </div>
              <div className="flex flex-wrap gap-2">
                {SHIP_ABILITIES.map((k) => {
                  const here = build.abilities.increases.filter((i) => i.ref === `t${t}` && i.ability === k).length;
                  return (
                    <span key={k} className="flex items-center gap-1">
                      <button type="button" className="ht-step" disabled={!editable || here === 0}
                        onClick={() => dispatch({ t: 'allocateTierPoint', tier: t, ability: k, delta: -1 })}>−</button>
                      <span className="text-ht-muted">{LABEL[k]}</span>
                      <b className="text-ht-bright">+{here}</b>
                      <button type="button" className="ht-step" disabled={!editable || spent >= TIER_POINT_BUDGET}
                        onClick={() => dispatch({ t: 'allocateTierPoint', tier: t, ability: k, delta: 1 })}>+</button>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
}
