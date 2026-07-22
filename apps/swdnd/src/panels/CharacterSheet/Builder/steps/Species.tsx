// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Species.tsx
import type { BuildAction } from '../../../../lib/buildState';
import type { AbilityKey, CharacterBuild, ReferenceData, RefSpecies } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function asiLabel(s: RefSpecies): string {
  const inc = s.abilityIncreases;
  if (!inc) return '—';
  const fixed = Object.entries(inc.fixed).map(([a, n]) => `+${n} ${a.toUpperCase()}`);
  if (inc.points > 0) fixed.push(`+${inc.points} free`);
  return fixed.join(', ') || '—';
}

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function SpeciesStep({ build, ref, editable, dispatch }: Props) {
  const chosen = ref.species[build.identity.speciesId];
  const points = chosen?.abilityIncreases?.points ?? 0;
  const choiceRef = `${build.identity.speciesId}#choice`;
  const allocatedBy = (a: AbilityKey) =>
    build.abilities.increases.filter((i) => i.ref === choiceRef && i.ability === a).reduce((s, i) => s + i.amount, 0);
  const allocated = ABILITIES.reduce((s, a) => s + allocatedBy(a), 0);

  return (
    <StepTable
      items={Object.values(ref.species)}
      columns={[
        { key: 'name', label: 'Name', flex: 1.4, value: (s) => s.name },
        { key: 'asi', label: 'Ability Increase', flex: 1.2, value: asiLabel },
        { key: 'speed', label: 'Speed', flex: 0.5, value: (s) => s.walkSpeed },
      ]}
      idOf={(s) => s.id}
      searchText={(s) => s.name}
      isSelected={(s) => s.id === build.identity.speciesId}
      onSelect={(s) => dispatch({ t: 'setSpecies', speciesId: s.id })}
      selectLabel={(s) => (s.id === build.identity.speciesId ? '◈ selected' : '✓ select species')}
      detail={(s) => s.description || 'No description in the source data.'}
      editable={editable}
      header={
        chosen && points > 0 ? (
          <div className="ht-glow flex flex-wrap items-center gap-2 rounded p-2">
            <span className="ht-label">{chosen.name} free points · {points - allocated} left</span>
            {ABILITIES.map((a) => (
              <span key={a} className="flex items-center gap-1">
                <span className="text-ht-muted">{a.toUpperCase()}</span>
                {editable && <button type="button" className="ht-step" onClick={() => dispatch({ t: 'allocateSpeciesPoint', ability: a, delta: -1 })}>−</button>}
                <b className="text-ht-bright">{allocatedBy(a)}</b>
                {editable && <button type="button" className="ht-step" onClick={() => dispatch({ t: 'allocateSpeciesPoint', ability: a, delta: 1 })}>+</button>}
              </span>
            ))}
          </div>
        ) : null
      }
    />
  );
}
