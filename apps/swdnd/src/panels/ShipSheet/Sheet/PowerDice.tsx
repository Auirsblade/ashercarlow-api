// apps/swdnd/src/panels/ShipSheet/Sheet/PowerDice.tsx
import Stepper from '../../CharacterSheet/Sheet/Stepper';
import { parseFormula, rollFormula } from '../../../lib/dice';
import type { ShipPlayAction, PowerLocation } from '../../../lib/shipPlayState';
import { powerDiceOf } from '../../../lib/shipRules/power';
import { POWER_SYSTEMS } from '../../../lib/shipRules/constants';
import type { DerivedShip, ShipPlayState } from '../../../lib/shipRules/types';

interface Props {
  derived: DerivedShip;
  play: ShipPlayState;
  editable: boolean;
  dispatch: (a: ShipPlayAction) => void;
  onRoll?: (label: string, formula: string, total: number) => void;
}

export default function PowerDice({ derived, play, editable, dispatch, onRoll }: Props) {
  const pool = powerDiceOf(play);
  const { die, coupling, capacity, recovery } = derived.power;

  const rollRecovery = () => {
    const terms = parseFormula(recovery.formula);
    const total = terms ? rollFormula(terms).total : Number(recovery.formula) || 0;
    // Reporting only: the player decides where the recovered dice go.
    onRoll?.('Reactor recovery', recovery.formula, total);
  };

  const row = (label: string, where: PowerLocation, value: number, max: number) => (
    <div key={where} className="flex items-center justify-between text-ht-text">
      <span>{label}</span>
      <Stepper
        value={value}
        max={max}
        editable={editable && max > 0}
        onDelta={(d) => dispatch(d > 0 ? { t: 'recoverPower', where, n: d } : { t: 'spendPower', where, n: -d })}
        onSet={(n) => dispatch({ t: 'setPower', where, n })}
      />
    </div>
  );

  // Capacity can drop below what's already stored (e.g. swapping to a
  // lower-capacity coupling mid-game) -- the stored pool isn't clamped until
  // the next dispatch touches it (Task 8). Gate rows on "there's something to
  // show" (capacity OR a nonzero stored pool), not capacity alone, so an
  // overflowed pool renders as a plain read-only "4/0" (Stepper turns
  // non-editable once max is 0) instead of silently disappearing.
  const showCentral = capacity.central > 0 || pool.central > 0;
  const systemRows = POWER_SYSTEMS.filter((s) => capacity.perSystem > 0 || pool.systems[s] > 0);

  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1 flex justify-between">
        <span>Power dice</span>
        <span className="text-ht-muted">
          {die.label}{coupling ? ` · ${coupling.replace('-', ' & ')}` : ' · no coupling'}
        </span>
      </div>

      {showCentral && row('Central', 'central', pool.central, capacity.central)}
      {systemRows.map((s) => row(s[0].toUpperCase() + s.slice(1), s, pool.systems[s], capacity.perSystem))}
      {!showCentral && systemRows.length === 0 && (
        <div className="text-ht-muted">Install a power coupling to store power dice.</div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-ht-line pt-1 text-[10px] text-ht-muted">
        <span>Reactor recovery · {recovery.label} at the start of your turn</span>
        {editable && recovery.formula !== '0' && (
          <button type="button" className="ht-step" onClick={rollRecovery}>⟳ roll {recovery.formula}</button>
        )}
      </div>
    </div>
  );
}
