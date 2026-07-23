// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Class.tsx
import { useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import { multiclassBlockers } from '../../../../lib/multiclass';
import { ABILITIES } from '../../../../lib/rules/constants';
import { classesTaken } from '../../../../lib/rules/core';
import type {
  CharacterBuild, LevelEntry, ReferenceData, RefClass,
} from '../../../../lib/rules/types';
import StepTable from '../StepTable';

const casting = (c: RefClass): string => {
  const parts: string[] = [];
  if (c.powercasting.force !== 'none') parts.push(`Force (${c.powercasting.force})`);
  if (c.powercasting.tech !== 'none') parts.push(`Tech (${c.powercasting.tech})`);
  return parts.join(' · ') || '—';
};

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

/** The entry's ordinal within its own class (Consular 1, 2, … regardless of interleaving). */
function classLevelOf(build: CharacterBuild, entry: LevelEntry): number {
  let count = 0;
  for (const l of build.levels) {
    if (l.classId === entry.classId) count += 1;
    if (l.n === entry.n) break;
  }
  return count;
}

function HpControl({ entry, die, editable, dispatch }: {
  entry: LevelEntry; die: number; editable: boolean; dispatch: (a: BuildAction) => void;
}) {
  const [editing, setEditing] = useState(false);
  const avg = Math.floor(die / 2) + 1;
  if (entry.n === 1) return <span className="text-ht-muted">hp max ({die})</span>;
  if (editing) {
    return (
      <input
        autoFocus type="number" min={1} max={die}
        defaultValue={entry.hp === 'avg' ? avg : entry.hp}
        className="w-12 border-b border-ht-line bg-transparent text-center text-ht-bright outline-none"
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) dispatch({ t: 'setLevelHp', n: entry.n, hp: v });
          setEditing(false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button type="button" disabled={!editable}
        className={entry.hp === 'avg' ? 'ht-step' : 'text-ht-muted'}
        onClick={() => dispatch({ t: 'setLevelHp', n: entry.n, hp: 'avg' })}>
        avg {avg}
      </button>
      <button type="button" disabled={!editable}
        className={entry.hp === 'avg' ? 'text-ht-muted' : 'ht-step'}
        onClick={() => setEditing(true)}>
        {entry.hp === 'avg' ? 'roll…' : `roll ${entry.hp}`}
      </button>
    </span>
  );
}

function AsiRow({ build, ref, entry, editable, dispatch }: {
  build: CharacterBuild; ref: ReferenceData; entry: LevelEntry;
  editable: boolean; dispatch: (a: BuildAction) => void;
}) {
  const asiRef = `l${entry.n}`;
  const allocated = build.abilities.increases.filter((i) => i.ref === asiRef);
  const spent = allocated.reduce((s, i) => s + i.amount, 0);
  const choice = entry.choices?.asiOrFeat as 'asi' | 'feat' | undefined;
  const featId = entry.choices?.featId as string | undefined;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
      <span className="ht-label">ASI level</span>
      <button type="button" disabled={!editable}
        className={`ht-step ${choice === 'asi' ? 'ht-tile-active' : ''}`}
        onClick={() => dispatch({ t: 'setAsiChoice', n: entry.n, choice: choice === 'asi' ? null : 'asi' })}>
        +2 ability points
      </button>
      <button type="button" disabled={!editable}
        className={`ht-step ${choice === 'feat' ? 'ht-tile-active' : ''}`}
        onClick={() => dispatch({ t: 'setAsiChoice', n: entry.n, choice: choice === 'feat' ? null : 'feat' })}>
        take a feat
      </button>
      {choice === 'asi' && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={spent < 2 ? 'text-yellow-300' : 'text-ht-muted'}>
            {2 - spent} pt{2 - spent === 1 ? '' : 's'} left
          </span>
          {ABILITIES.map((a) => {
            const pts = allocated.filter((i) => i.ability === a).reduce((s, i) => s + i.amount, 0);
            return (
              <span key={a} className="flex items-center gap-0.5">
                <span className={pts > 0 ? 'text-ht-bright' : 'text-ht-muted'}>
                  {a.toUpperCase()}{pts > 0 ? ` +${pts}` : ''}
                </span>
                {editable && (
                  <>
                    <button type="button" className="ht-step px-1"
                      onClick={() => dispatch({ t: 'allocateAsiPoint', n: entry.n, ability: a, delta: 1 })}>+</button>
                    <button type="button" className="ht-step px-1"
                      onClick={() => dispatch({ t: 'allocateAsiPoint', n: entry.n, ability: a, delta: -1 })}>−</button>
                  </>
                )}
              </span>
            );
          })}
        </span>
      )}
      {choice === 'feat' && (
        <span className={featId ? 'text-ht-muted' : 'text-yellow-300'}>
          {featId ? `feat: ${ref.feats[featId]?.name ?? featId}` : 'pick your feat on the Feats step'}
        </span>
      )}
    </div>
  );
}

export default function ClassStep({ build, ref, editable, dispatch }: Props) {
  // picker: null = level log · 'add' = class table · `arch:<classId>` = archetype table
  const [picker, setPicker] = useState<string | null>(build.levels.length === 0 ? 'add' : null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const houseRuled = (build.houseRuled ?? []).includes('class');
  const taken = classesTaken(build);
  const lastEntry = build.levels[build.levels.length - 1];

  const houseRuleHeader = (
    <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[10px] text-ht-muted">
      <span>Multiclassing needs 13+ in the primary ability of both classes.</span>
      <button type="button" className={`ht-step ml-auto ${houseRuled ? 'ht-tile-active' : ''}`}
        onClick={() => dispatch({ t: 'toggleHouseRule', step: 'class' })}>
        ⌂ house rule {houseRuled ? 'on' : 'off'}
      </button>
    </div>
  );

  if (picker === 'add') {
    return (
      <div className="flex flex-col gap-2 text-[11px]">
        {build.levels.length > 0 && (
          <button type="button" className="ht-step self-start" onClick={() => setPicker(null)}>
            ◂ back to level log
          </button>
        )}
        <StepTable
          items={Object.values(ref.classes)}
          columns={[
            { key: 'name', label: 'Name', flex: 1.2, value: (c) => c.name },
            { key: 'die', label: 'Hit Die', flex: 0.6, value: (c) => `d${c.hitDie}` },
            { key: 'casting', label: 'Casting', flex: 1, value: casting },
            { key: 'sup', label: 'Superiority', flex: 0.8, value: (c) => (c.superiorityProgression > 0 ? `${c.superiorityProgression}× prog.` : '—') },
          ]}
          idOf={(c) => c.id}
          searchText={(c) => c.name}
          isSelected={() => false}
          disabledReason={(c) => (houseRuled ? null : (multiclassBlockers(build, ref, c.id)[0] ?? null))}
          onSelect={(c) => { dispatch({ t: 'addLevel', classId: c.id }); setPicker(null); }}
          selectLabel={() => `✓ take level ${build.levels.length + 1}`}
          detail={(c) => [
            `SAVES · ${c.saves.map((s) => s.toUpperCase()).join(', ')}   SKILLS · pick ${c.skillNumber}`,
            c.description || 'No description in the source data.',
          ].join('\n')}
          editable={editable}
          header={houseRuleHeader}
        />
      </div>
    );
  }

  if (picker?.startsWith('arch:')) {
    const classId = picker.slice(5);
    const cls = ref.classes[classId];
    const current = taken.find((t) => t.classId === classId)?.archetypeId ?? null;
    const options = Object.values(ref.archetypes)
      .filter((a) => houseRuled || a.classIdentifier === cls?.identifier);
    return (
      <div className="flex flex-col gap-2 text-[11px]">
        <button type="button" className="ht-step self-start" onClick={() => setPicker(null)}>
          ◂ back to level log
        </button>
        <StepTable
          items={options}
          columns={[{ key: 'name', label: `${cls?.name ?? ''} archetypes`, flex: 1, value: (a) => a.name }]}
          idOf={(a) => a.id}
          searchText={(a) => a.name}
          isSelected={(a) => a.id === current}
          onSelect={(a) => {
            dispatch({ t: 'setArchetype', classId, archetypeId: a.id === current ? null : a.id });
            setPicker(null);
          }}
          selectLabel={(a) => (a.id === current ? '✕ clear archetype' : '✓ choose archetype')}
          detail={(a) => a.description || 'No description in the source data.'}
          editable={editable}
          header={houseRuled ? houseRuleHeader : undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      {houseRuleHeader}
      {taken.map((t) => {
        const cls = ref.classes[t.classId];
        const arch = t.archetypeId ? ref.archetypes[t.archetypeId] : null;
        return (
          <div key={t.classId} className="ht-panel p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ht-bright">{cls?.name ?? t.classId}</span>
              <span className="text-ht-muted">· {t.levels} level{t.levels === 1 ? '' : 's'} · d{cls?.hitDie ?? '?'}</span>
              {t.levels >= 3 && (
                <button type="button" disabled={!editable}
                  className={`ht-step ml-auto ${arch ? '' : 'text-yellow-300'}`}
                  onClick={() => setPicker(`arch:${t.classId}`)}>
                  {arch ? arch.name : 'choose archetype ▸'}
                </button>
              )}
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {build.levels.filter((l) => l.classId === t.classId).map((entry) => {
                const classLevel = classLevelOf(build, entry);
                const isAsi = (cls?.asiLevels ?? []).includes(classLevel);
                return (
                  <div key={entry.n} className="border-t border-ht-line pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ht-label">L{entry.n}</span>
                      <span className="text-ht-muted">{cls?.name ?? t.classId} {classLevel}</span>
                      <span className="ml-auto">
                        <HpControl entry={entry} die={cls?.hitDie ?? 6} editable={editable} dispatch={dispatch} />
                      </span>
                    </div>
                    {isAsi && <AsiRow build={build} ref={ref} entry={entry} editable={editable} dispatch={dispatch} />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        {editable && build.levels.length < 20 && (
          <button type="button" className="ht-step" onClick={() => setPicker('add')}>
            + add level {build.levels.length + 1}
          </button>
        )}
        {editable && lastEntry && (confirmRemove ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-ht-muted">
              remove L{lastEntry.n} ({ref.classes[lastEntry.classId]?.name ?? lastEntry.classId})?
            </span>
            <button type="button" className="ht-step text-red-400"
              onClick={() => { dispatch({ t: 'removeLastLevel' }); setConfirmRemove(false); }}>
              confirm ✕
            </button>
            <button type="button" className="ht-step" onClick={() => setConfirmRemove(false)}>keep</button>
          </span>
        ) : (
          <button type="button" className="ml-auto text-[10px] text-ht-muted" onClick={() => setConfirmRemove(true)}>
            − remove last level
          </button>
        ))}
      </div>
      <div className="text-[10px] text-ht-muted">
        Level changes carry into your current HP automatically; level 1 always takes the full die.
      </div>
    </div>
  );
}
