// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Class.tsx
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData, RefClass } from '../../../../lib/rules/types';
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

export default function ClassStep({ build, ref, editable, dispatch }: Props) {
  const chosenId = build.levels[0]?.classId;
  return (
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
      isSelected={(c) => c.id === chosenId}
      onSelect={(c) => dispatch({ t: 'setClass', classId: c.id })}
      selectLabel={(c) => (c.id === chosenId ? '◈ selected' : '✓ choose class')}
      detail={(c) => [
        `SAVES · ${c.saves.map((s) => s.toUpperCase()).join(', ')}   SKILLS · pick ${c.skillNumber}`,
        c.description || 'No description in the source data.',
        chosenId && chosenId !== c.id ? '⚠ changing class re-flags your Skills and Powers steps.' : null,
      ].filter(Boolean).join('\n')}
      editable={editable}
    />
  );
}
