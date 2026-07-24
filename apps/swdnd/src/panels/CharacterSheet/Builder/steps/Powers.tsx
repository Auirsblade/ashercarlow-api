// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Powers.tsx
import { useState } from 'react';
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, DerivedSheet, ReferenceData } from '../../../../lib/rules/types';
import StepTable from '../StepTable';

type Tab = 'force' | 'tech' | 'maneuvers';

interface Props {
  build: CharacterBuild;
  derived: DerivedSheet;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function PowersStep({ build, derived, ref, editable, dispatch }: Props) {
  const unlocked = (build.houseRuled ?? []).includes('powers');
  const force = derived.casting.force;
  const tech = derived.casting.tech;
  const supMax = derived.superiority?.knownMax ?? 0;
  const tabs: Tab[] = [
    ...(force.knownMax > 0 || unlocked ? (['force'] as Tab[]) : []),
    ...(tech.knownMax > 0 || unlocked ? (['tech'] as Tab[]) : []),
    ...(supMax > 0 || unlocked ? (['maneuvers'] as Tab[]) : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'force');
  const activeTab = tabs.includes(tab) ? tab : tabs[0] ?? 'force';

  const knownIn = (t: 'force' | 'tech') => build.knownPowers.filter((id) => ref.powers[id]?.castType === t).length;

  const header = (
    <div className="ht-glow flex flex-wrap items-center gap-3 rounded p-2 text-[10px]">
      {force.knownMax > 0 && <span>force <b className="text-ht-bright">{knownIn('force')}/{force.knownMax}</b> · max lvl {force.maxPowerLevel}</span>}
      {tech.knownMax > 0 && <span>tech <b className="text-ht-bright">{knownIn('tech')}/{tech.knownMax}</b> · max lvl {tech.maxPowerLevel}</span>}
      {supMax > 0 && <span>maneuvers <b className="text-ht-bright">{build.knownManeuvers.length}/{supMax}</b> · {derived.superiority?.die}</span>}
      {editable && (
        <button type="button" onClick={() => dispatch({ t: 'toggleHouseRule', step: 'powers' })}
          className={`ml-auto ht-step ${unlocked ? 'text-yellow-300' : ''}`}>
          ⌂ house rule: {unlocked ? 'unlocked' : 'locked'}
        </button>
      )}
    </div>
  );

  if (tabs.length === 0) {
    return <div className="ht-panel p-4 text-[11px] text-ht-muted">This build has no powers or maneuvers at level 1.</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {header}
      <div className="flex shrink-0 gap-1 text-[11px]">
        {tabs.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 capitalize ${activeTab === t ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}>
            {t}
          </button>
        ))}
      </div>

      {activeTab !== 'maneuvers' ? (
        <StepTable
          key={activeTab}
          items={Object.values(ref.powers).filter((p) =>
            p.castType === activeTab && (unlocked || p.level <= derived.casting[activeTab].maxPowerLevel),
          )}
          columns={[
            { key: 'name', label: 'Name', flex: 1.4, value: (p) => p.name },
            { key: 'level', label: 'Level', flex: 0.5, value: (p) => p.level },
          ]}
          idOf={(p) => p.id}
          searchText={(p) => p.name}
          isSelected={(p) => build.knownPowers.includes(p.id)}
          onSelect={(p) => dispatch({ t: 'togglePower', powerId: p.id })}
          selectLabel={(p) => (build.knownPowers.includes(p.id) ? '✕ forget' : '✓ learn')}
          detail={(p) => p.description || 'No description in the source data.'}
          editable={editable}
        />
      ) : (
        <StepTable
          key="maneuvers"
          items={Object.values(ref.maneuvers)}
          columns={[
            { key: 'name', label: 'Name', flex: 1.4, value: (m) => m.name },
            { key: 'type', label: 'Type', flex: 0.6, value: (m) => m.maneuverType },
          ]}
          idOf={(m) => m.id}
          searchText={(m) => `${m.name} ${m.maneuverType}`}
          isSelected={(m) => build.knownManeuvers.includes(m.id)}
          onSelect={(m) => dispatch({ t: 'toggleManeuver', maneuverId: m.id })}
          selectLabel={(m) => (build.knownManeuvers.includes(m.id) ? '✕ forget' : '✓ learn')}
          detail={(m) => m.description || 'No description in the source data.'}
          editable={editable}
        />
      )}
    </div>
  );
}
