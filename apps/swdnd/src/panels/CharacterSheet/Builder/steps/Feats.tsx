// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Feats.tsx
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
  const chosen = build.levels[0]?.choices?.featId as string | undefined;
  const bg = ref.backgrounds[build.identity.backgroundId];
  return (
    <StepTable
      items={Object.values(ref.feats)}
      columns={[
        { key: 'name', label: 'Name', flex: 1.2, value: (f) => f.name },
        { key: 'req', label: 'Requirements', flex: 1, value: (f) => f.requirements ?? '—' },
      ]}
      idOf={(f) => f.id}
      searchText={(f) => `${f.name} ${f.requirements ?? ''}`}
      isSelected={(f) => f.id === chosen}
      onSelect={(f) => dispatch({ t: 'setFeatForLevel', n: 1, featId: f.id === chosen ? null : f.id })}
      selectLabel={(f) => (f.id === chosen ? '✕ clear feat' : '✓ take feat')}
      detail={(f) => f.description || 'No description in the source data.'}
      editable={editable}
      header={
        <div className="ht-panel p-2 text-[10px] text-ht-muted">
          Optional at level 1{bg ? ` — your background (${bg.name}) suggests feat options in its description` : ''}.
          Mechanical effects of feats land with the builder's progression phase; the pick is recorded on the build.
        </div>
      }
    />
  );
}
