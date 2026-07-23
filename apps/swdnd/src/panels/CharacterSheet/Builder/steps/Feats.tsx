// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx
import { useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function FeatsStep({ build, ref, editable, dispatch }: Props) {
  const bg = ref.backgrounds[build.identity.backgroundId];
  const slots = [
    {
      n: 1, label: 'L1 (optional)', optional: true,
      featId: build.levels[0]?.choices?.featId as string | undefined,
    },
    ...build.levels
      .filter((l) => l.n !== 1 && l.choices?.asiOrFeat === 'feat')
      .map((l) => ({
        n: l.n,
        label: `L${l.n} (${ref.classes[l.classId]?.name ?? l.classId})`,
        optional: false,
        featId: l.choices?.featId as string | undefined,
      })),
  ];
  const [armed, setArmed] = useState(1);
  const armedSlot = slots.find((s) => s.n === armed) ?? slots[0];

  return (
    <StepTable
      items={Object.values(ref.feats)}
      columns={[
        { key: 'name', label: 'Name', flex: 1.2, value: (f) => f.name },
        { key: 'req', label: 'Requirements', flex: 1, value: (f) => f.requirements ?? '—' },
      ]}
      idOf={(f) => f.id}
      searchText={(f) => `${f.name} ${f.requirements ?? ''}`}
      isSelected={(f) => f.id === armedSlot.featId}
      onSelect={(f) => dispatch({
        t: 'setFeatForLevel', n: armedSlot.n,
        featId: f.id === armedSlot.featId ? null : f.id,
      })}
      selectLabel={(f) => (f.id === armedSlot.featId ? '✕ clear feat' : `✓ take for ${armedSlot.label}`)}
      detail={(f) => f.description || 'No description in the source data.'}
      editable={editable}
      header={
        <div className="flex flex-col gap-1">
          {slots.length > 1 && (
            <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[10px]">
              <span className="ht-label">Slots</span>
              {slots.map((s) => (
                <button key={s.n} type="button"
                  className={`ht-step ${s.n === armedSlot.n ? 'ht-tile-active' : ''} ${!s.optional && !s.featId ? 'text-yellow-300' : ''}`}
                  onClick={() => setArmed(s.n)}>
                  {s.label} · {s.featId ? ref.feats[s.featId]?.name ?? s.featId : 'empty'}
                </button>
              ))}
            </div>
          )}
          <div className="ht-panel p-2 text-[10px] text-ht-muted">
            {slots.length > 1
              ? 'Picking a feat fills the armed slot.'
              : 'Optional at level 1 — ASI levels that elect a feat add slots here.'}
            {bg ? ` Your background (${bg.name}) suggests options in its description.` : ''}
            {' '}Feat effects are read at the table; the pick is recorded on the build.
          </div>
        </div>
      }
    />
  );
}
