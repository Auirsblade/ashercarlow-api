// apps/swdnd/src/panels/CharacterSheet/Sheet/CoreBar.tsx
import { Link, useLocation } from 'react-router-dom';
import { PanelLink } from '../../../components/split';
import type { CharacterBuild, DerivedSheet, PlayState, ReferenceData } from '../../../lib/rules/types';
import type { PlayAction } from '../../../lib/playState';
import { classSummary, remaining } from '../../../lib/sheetView';
import Stepper from './Stepper';
import ConditionsMenu from './ConditionsMenu';

interface Props {
  characterId: string;
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  play: PlayState;
  editable: boolean;
  dispatch: (a: PlayAction) => void;
  campaignId: string | null;
}

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ht-panel px-3 py-2 text-center">
      <div className="ht-label">{label}</div>
      <b className="text-base text-ht-bright">{value}</b>
    </div>
  );
}

export default function CoreBar({ characterId, build, derived, ref, play, editable, dispatch, campaignId }: Props) {
  const { force, tech } = derived.casting;
  const { search } = useLocation(); // carry ?token=… into the builder
  const classLine = classSummary(build, ref) || `Level ${build.levels.length}`;
  const speciesName = ref.species[build.identity.speciesId]?.name;
  return (
    <div className="ht-glow flex flex-wrap items-center gap-2 rounded-md p-3">
      <div className="min-w-[120px]">
        <div className="ht-name font-mono text-sm font-bold">{build.identity.name || 'Unnamed'}</div>
        <div className="text-[10px] text-ht-muted">
          {classLine} · <span className="capitalize" style={{ color: 'var(--faction)' }}>{build.identity.alignment}</span>
          {speciesName && ` · ${speciesName}`}
        </div>
        <Link to={`/sheet/${characterId}/build${search}`} className="ht-label" style={{ cursor: 'pointer' }}>✎ Edit / Level up ▸</Link>
        {campaignId && (
          <PanelLink
            to={{ kind: 'map', id: campaignId }}
            current={{ kind: 'sheet', id: characterId }}
            className="ht-label block"
            title="open the campaign map (alt-click: beside the sheet)"
          >
            ⬡ Map ▸
          </PanelLink>
        )}
      </div>

      <div className="ht-panel px-3 py-2 text-center">
        <div className="ht-label">Hit Points</div>
        <Stepper value={play.hp} max={derived.maxHp} editable={editable}
          onDelta={(d) => dispatch(d < 0 ? { t: 'damage', n: -d } : { t: 'heal', n: d })}
          onSet={(v) => dispatch({ t: 'setHp', n: v })} />
        <div className="text-[10px] text-ht-muted">temp +{play.tempHp} · HD {remaining(derived.totalLevel, play.hitDiceSpent)}</div>
      </div>

      {/* One flex child so AC…Prof wrap to a new line together, never split. */}
      <div className="flex gap-2">
        <Stat label="AC" value={derived.armorClass} />
        <Stat label="Init" value={fmt(derived.initiative)} />
        <Stat label="Speed" value={derived.speed} />
        <Stat label="Prof" value={fmt(derived.proficiencyBonus)} />
      </div>

      {force.classes > 0 && (
        <div className="ht-glow rounded-md px-3 py-2 text-center">
          <div className="ht-label">Force Pts</div>
          <Stepper value={remaining(force.pointsMax, play.forcePointsSpent)} max={force.pointsMax} editable={editable}
            onDelta={(d) => dispatch({ t: 'spendForce', n: -d })}
            onSet={(v) => dispatch({ t: 'spendForce', n: remaining(force.pointsMax, play.forcePointsSpent) - v })} />
          <div className="text-[10px] text-ht-muted">max lvl {force.maxPowerLevel} · DC {force.saveDc} · atk {fmt(force.attackBonus ?? 0)}</div>
        </div>
      )}
      {tech.classes > 0 && (
        <div className="ht-glow rounded-md px-3 py-2 text-center">
          <div className="ht-label">Tech Pts</div>
          <Stepper value={remaining(tech.pointsMax, play.techPointsSpent)} max={tech.pointsMax} editable={editable}
            onDelta={(d) => dispatch({ t: 'spendTech', n: -d })}
            onSet={(v) => dispatch({ t: 'spendTech', n: remaining(tech.pointsMax, play.techPointsSpent) - v })} />
          <div className="text-[10px] text-ht-muted">max lvl {tech.maxPowerLevel} · DC {tech.saveDc} · atk {fmt(tech.attackBonus ?? 0)}</div>
        </div>
      )}

      {/* Wide: right-aligned column at the bar's end. Narrow: its own full row, left-aligned. */}
      <div className="flex w-full flex-row flex-wrap items-center gap-2 @lg:ml-auto @lg:w-auto @lg:flex-col @lg:items-end @lg:gap-1">
        <ConditionsMenu active={play.conditions} editable={editable}
          onAdd={(c) => dispatch({ t: 'addCondition', c })}
          onRemove={(c) => dispatch({ t: 'removeCondition', c })} />
        <div className="flex items-center gap-2 text-[10px] text-ht-muted">
          <button type="button" disabled={!editable} onClick={() => dispatch({ t: 'toggleInspiration' })}>
            {play.inspiration ? '◆' : '◇'} Inspiration
          </button>
          <span>Exhaustion {play.exhaustion}</span>
          {editable && (
            <span>
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setExhaustion', n: play.exhaustion - 1 })}>−</button>
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'setExhaustion', n: play.exhaustion + 1 })}>+</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
