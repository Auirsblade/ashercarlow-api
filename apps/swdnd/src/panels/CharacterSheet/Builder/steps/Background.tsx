// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Background.tsx
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function BackgroundStep({ build, ref, editable, dispatch }: Props) {
  return (
    <StepTable
      items={Object.values(ref.backgrounds)}
      columns={[
        { key: 'name', label: 'Name', flex: 1, value: (b) => b.name },
        { key: 'feature', label: 'Feature', flex: 1.4, value: (b) => b.featureName ?? '—' },
      ]}
      idOf={(b) => b.id}
      searchText={(b) => `${b.name} ${b.featureName ?? ''}`}
      isSelected={(b) => b.id === build.identity.backgroundId}
      onSelect={(b) => dispatch({ t: 'setBackground', backgroundId: b.id })}
      selectLabel={(b) => (b.id === build.identity.backgroundId ? '◈ selected' : '✓ select background')}
      detail={(b) => [
        b.skillProse && `SKILLS · ${b.skillProse}`,
        b.toolProse && `TOOLS · ${b.toolProse}`,
        b.equipmentProse && `EQUIPMENT · ${b.equipmentProse}`,
        b.description,
        'Apply the skill/tool grants in the Skills step; grab the gear in Equipment.',
      ].filter(Boolean).join('\n')}
      editable={editable}
    />
  );
}
