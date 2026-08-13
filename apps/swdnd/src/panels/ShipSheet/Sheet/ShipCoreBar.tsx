// apps/swdnd/src/panels/ShipSheet/Sheet/ShipCoreBar.tsx
import { Link, useLocation } from 'react-router-dom';
import { PanelLink } from '../../../components/split';
import { MAX_SYSTEM_DAMAGE } from '../../../lib/shipRules/constants';
import type { ShipPlayAction } from '../../../lib/shipPlayState';
import type { DerivedShip, ShipBuild, ShipPlayState } from '../../../lib/shipRules/types';
import PoolBar from './PoolBar';
import ShipConditionsMenu from './ShipConditionsMenu';

interface Props {
  shipId: string;
  build: ShipBuild;
  derived: DerivedShip;
  play: ShipPlayState;
  editable: boolean;
  campaignId: string | null;
  dispatch: (a: ShipPlayAction) => void;
  onPatchHull: () => void;
  onRegenerateShields: () => void;
}

const remaining = (max: number, spent: number) => Math.max(0, max - spent);

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ht-panel px-3 py-2 text-center">
      <div className="ht-label">{label}</div>
      <b className="text-base text-ht-bright">{value}</b>
    </div>
  );
}

export default function ShipCoreBar({
  shipId, build, derived, play, editable, campaignId, dispatch, onPatchHull, onRegenerateShields,
}: Props) {
  const { search } = useLocation(); // carry ?token=… into the builder
  return (
    <div className="ht-glow flex flex-wrap items-start gap-2 rounded-md p-3">
      <div className="min-w-[140px]">
        <div className="ht-name font-mono text-sm font-bold">{build.identity.name || 'Unnamed ship'}</div>
        <div className="text-[10px] text-ht-muted">tier {derived.tier} · {derived.rateOfFireCap} weapons/round</div>
        <Link to={`/ship/${shipId}/build${search}`} className="ht-label" style={{ cursor: 'pointer' }}>✎ Refit ▸</Link>
        {campaignId && (
          <PanelLink
            to={{ kind: 'map', id: campaignId }}
            current={{ kind: 'ship', id: shipId }}
            className="ht-label block"
            title="open the campaign map (alt-click: beside the ship)"
          >
            ⬡ Map ▸
          </PanelLink>
        )}
      </div>

      {/* Shields OVER hull — the double ring the map mode will mirror. */}
      <div className="flex min-w-[220px] flex-col gap-2">
        <PoolBar
          label="Shields" tone="shields" value={play.shields} max={derived.maxShields} editable={editable}
          diceLabel={`d${derived.shieldDice.die}`}
          diceRemaining={remaining(derived.shieldDice.count, play.shieldDiceSpent)}
          diceMax={derived.shieldDice.count}
          onDelta={(d) => dispatch(d < 0 ? { t: 'damage', n: -d } : { t: 'restoreShields', n: d })}
          onSet={(v) => dispatch({ t: 'setShields', n: v })}
          onSpendDie={() => dispatch({ t: 'spendShieldDie' })}
          onRegainDie={() => dispatch({ t: 'regainShieldDie' })}
          action={derived.maxShields > 0 ? {
            label: `⟳ Regenerate (+${derived.shieldRegen})`,
            title: 'spend a shield die and restore the fixed regen rate (the die is not rolled)',
            onClick: onRegenerateShields,
          } : undefined}
        />
        <PoolBar
          label="Hull" tone="hull" value={play.hull} max={derived.maxHull} editable={editable}
          diceLabel={`d${derived.hullDice.die}`}
          diceRemaining={remaining(derived.hullDice.count, play.hullDiceSpent)}
          diceMax={derived.hullDice.count}
          onDelta={(d) => dispatch(d < 0 ? { t: 'damage', n: -d } : { t: 'repairHull', n: d })}
          onSet={(v) => dispatch({ t: 'setHull', n: v })}
          onSpendDie={() => dispatch({ t: 'spendHullDie' })}
          onRegainDie={() => dispatch({ t: 'regainHullDie' })}
          action={{
            label: '✚ Patch',
            title: 'spend a hull die, roll it, and repair the result',
            onClick: onPatchHull,
          }}
        />
      </div>

      {/* One flex child so AC…Turn wrap together, never split. */}
      <div className="flex gap-2">
        <Stat label="AC" value={derived.armorClass} />
        <Stat label="DR" value={derived.damageReduction} />
        <Stat label="Speed" value={derived.speed} />
        <Stat label="Turn" value={derived.turnSpeed} />
      </div>

      <div className="flex w-full flex-row flex-wrap items-center gap-2 @lg:ml-auto @lg:w-auto @lg:flex-col @lg:items-end @lg:gap-1">
        <ShipConditionsMenu
          active={play.conditions} editable={editable}
          onAdd={(c) => dispatch({ t: 'addCondition', c })}
          onRemove={(c) => dispatch({ t: 'removeCondition', c })}
        />
        <div className="flex items-center gap-2 text-[10px] text-ht-muted">
          {/* System damage is its own 0-6 field, never a condition string. */}
          <span>System damage {play.systemDamage}/{MAX_SYSTEM_DAMAGE}</span>
          {editable && (
            <span>
              <button type="button" className="ht-step"
                onClick={() => dispatch({ t: 'setSystemDamage', n: play.systemDamage - 1 })}>−</button>
              <button type="button" className="ht-step"
                onClick={() => dispatch({ t: 'setSystemDamage', n: play.systemDamage + 1 })}>+</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
