// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Abilities.tsx
import { useState } from 'react';
import { STANDARD_ARRAY, POINT_BUY_BUDGET, budgetRemaining, scoreCost } from '../../../../lib/pointBuy';
import type { BuildAction } from '../../../../lib/buildState';
import type { AbilityKey, CharacterBuild, DerivedSheet } from '../../../../lib/rules/types';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
type Mode = 'manual' | 'array' | 'pointbuy';

interface Props {
  build: CharacterBuild;
  derived: DerivedSheet;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function AbilitiesStep({ build, derived, editable, dispatch }: Props) {
  const [mode, setMode] = useState<Mode>('manual');
  const base = build.abilities.base;
  const remaining = budgetRemaining(base);

  const set = (ability: AbilityKey, value: number) =>
    dispatch({ t: 'setBaseAbilities', base: { ...base, [ability]: value } });

  const arrayValueUsed = (v: number) =>
    ABILITIES.filter((a) => base[a] === v).length >= STANDARD_ARRAY.filter((x) => x === v).length;

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      <div className="flex gap-1">
        {(['manual', 'array', 'pointbuy'] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex-1 px-2 py-1 ${mode === m ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}>
            {m === 'manual' ? 'Manual (rolled)' : m === 'array' ? 'Standard array' : 'Point buy'}
          </button>
        ))}
      </div>

      {mode === 'array' && (
        <div className="ht-panel p-2 text-ht-muted">
          Assign {STANDARD_ARRAY.join(' / ')} — tap a value below each ability.
        </div>
      )}
      {mode === 'pointbuy' && (
        <div className={`p-2 ${remaining != null && remaining >= 0 ? 'ht-glow' : 'ht-panel border-yellow-400'}`}>
          <span className="ht-label">Budget</span>{' '}
          {remaining == null ? (
            <span className="text-yellow-300">⚠ a score is outside 8–15 — adjust below or switch to Manual</span>
          ) : remaining < 0 ? (
            <span className="text-yellow-300">⚠ {remaining}/{POINT_BUY_BUDGET} points remaining</span>
          ) : (
            `${remaining}/${POINT_BUY_BUDGET} points remaining`
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
        {ABILITIES.map((a) => {
          const speciesBonus = build.abilities.increases
            .filter((i) => i.source === 'species' && i.ability === a)
            .reduce((s, i) => s + i.amount, 0);
          return (
            <div key={a} className="ht-panel p-2 text-center">
              <div className="ht-label">{a}</div>
              {mode === 'manual' && (
                <input
                  type="number" min={1} max={20} disabled={!editable}
                  // appearance overrides kill the spin-button gutter that pushed the
                  // centered value off-axis from the label above it.
                  className="mx-auto block w-14 bg-transparent text-center text-base text-ht-bright outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={base[a]}
                  onChange={(e) => set(a, Number(e.target.value) || 0)}
                />
              )}
              {mode === 'array' && (
                // Grid, not flex-wrap: the six values always split evenly (3+3), never 5+1.
                <div className="grid grid-cols-3 justify-items-center gap-1">
                  {[...new Set(STANDARD_ARRAY)].map((v) => (
                    <button key={v} type="button" disabled={!editable}
                      onClick={() => set(a, v)}
                      className={`ht-step text-[10px] ${base[a] === v ? 'text-ht-bright' : arrayValueUsed(v) ? 'opacity-40' : ''}`}>
                      {v}
                    </button>
                  ))}
                </div>
              )}
              {mode === 'pointbuy' && (
                <div className="flex items-center justify-center gap-1">
                  <button type="button" disabled={!editable} className="ht-step" onClick={() => set(a, base[a] - 1)}>−</button>
                  <b className="w-8 text-base text-ht-bright">{base[a]}</b>
                  <button type="button" disabled={!editable} className="ht-step" onClick={() => set(a, base[a] + 1)}>+</button>
                </div>
              )}
              <div className="text-[9px] text-ht-muted">
                {mode === 'pointbuy' && scoreCost(base[a]) != null && `cost ${scoreCost(base[a])}`}
                {speciesBonus > 0 && ` · species +${speciesBonus}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-ht-muted">
        Species increases apply on top of these base scores — final values show on the sheet (max HP {derived.maxHp}).
      </div>
    </div>
  );
}
