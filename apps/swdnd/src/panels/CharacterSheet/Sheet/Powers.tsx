// apps/swdnd/src/panels/CharacterSheet/Sheet/Powers.tsx
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../../../lib/rules/types';
import type { PlayAction } from '../../../lib/playState';
import { knownPowersByLevel, remaining } from '../../../lib/sheetView';

interface Props {
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  editable: boolean;
  playForceSpent: number;
  playTechSpent: number;
  dispatch: (a: PlayAction) => void;
}

export default function Powers({ build, derived, ref, editable, playForceSpent, playTechSpent, dispatch }: Props) {
  const groups = knownPowersByLevel(build, ref);
  const tracks = [
    { key: 'force' as const, title: 'Force Powers', track: derived.casting.force, groups: groups.force, spent: playForceSpent },
    { key: 'tech' as const, title: 'Tech Powers', track: derived.casting.tech, groups: groups.tech, spent: playTechSpent },
  ].filter((t) => t.track.classes > 0);

  return (
    <div className="flex flex-col gap-2 font-mono text-[11px]">
      {tracks.map(({ key, title, track, groups: gs, spent }) => (
        <div key={key} className="ht-glow rounded p-2">
          <div className="flex justify-between">
            <span className="ht-label">{title}</span>
            <span className="text-ht-muted">
              {remaining(track.pointsMax, spent)}/{track.pointsMax} pts · known {track.knownMax}
            </span>
          </div>
          {gs.map((g) => (
            <div key={g.level} className="mt-1 border-t border-ht-line pt-1">
              <div className="text-[9px] text-ht-muted">
                {g.label.toUpperCase()} · {g.cost} pts{g.level === track.maxPowerLevel ? ' ◂ max' : ''}
              </div>
              {g.powers.map((p) => (
                <div key={p.id} className="flex justify-between text-ht-text">
                  <span>{p.name}</span>
                  {editable ? (
                    <button type="button" className="ht-step text-[10px]"
                      onClick={() => dispatch({ t: 'castPower', power: p })}>
                      cast {g.cost > 0 ? `−${g.cost}` : ''}
                    </button>
                  ) : (
                    <span className="text-ht-muted">{g.cost > 0 ? `−${g.cost}` : 'at-will'}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {editable && (
            <button type="button" className="mt-2 text-[9px] text-ht-muted"
              onClick={() => dispatch({ t: key === 'force' ? 'restForce' : 'restTech' })}>
              ↺ long rest — restore pool
            </button>
          )}
        </div>
      ))}

      {derived.superiority && (
        <div className="ht-panel p-2">
          <div className="ht-label">Superiority</div>
          <div className="flex justify-between text-ht-text">
            <span>{derived.superiority.die} dice</span>
            <span className="text-ht-muted">
              {remaining(derived.superiority.diceMax, build.play.superiorityDiceSpent)}/{derived.superiority.diceMax} · known {derived.superiority.knownMax}
            </span>
          </div>
          {editable && (
            <div className="mt-1 flex gap-2 text-[10px]">
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'spendSuperiority' })}>spend die</button>
              <button type="button" className="ht-step" onClick={() => dispatch({ t: 'regainSuperiority' })}>regain</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
