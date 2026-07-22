// apps/swdnd/src/panels/CharacterSheet/Builder/steps/Skills.tsx
import { SKILLS } from '../../../../lib/rules/constants';
import type { BuildAction } from '../../../../lib/buildState';
import type { CharacterBuild, ReferenceData, SkillKey } from '../../../../lib/rules/types';

interface Props {
  build: CharacterBuild;
  ref: ReferenceData;
  editable: boolean;
  dispatch: (a: BuildAction) => void;
}

export default function SkillsStep({ build, ref, editable, dispatch }: Props) {
  const cls = build.levels[0] ? ref.classes[build.levels[0].classId] : undefined;
  const classSet = new Set(cls?.skillChoices ?? []);
  const bg = ref.backgrounds[build.identity.backgroundId];
  const picked = new Set(build.proficiencies.skills);

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      <div className="ht-glow rounded p-2 text-ht-muted">
        <span className="ht-label">Guidance</span>{' '}
        {cls ? `${cls.name}: pick ${cls.skillNumber} from the highlighted class options.` : 'Choose a class first for its skill options.'}
        {bg?.skillProse && ` Background (${bg.name}): ${bg.skillProse}`}
      </div>
      <div className="grid grid-cols-1 gap-1 @md:grid-cols-2">
        {(Object.keys(SKILLS) as SkillKey[]).map((k) => {
          const meta = SKILLS[k];
          const isClass = classSet.has(k);
          const on = picked.has(k);
          return (
            <button
              key={k}
              type="button"
              disabled={!editable}
              onClick={() => dispatch({ t: 'toggleSkill', skill: k })}
              className={`flex items-center gap-2 px-2 py-1 text-left ${on ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}
            >
              <span>{on ? '◈' : '·'}</span>
              <span>{meta.label} <span className="text-ht-muted">({meta.ability})</span></span>
              {isClass && <span className="ml-auto text-[9px] text-ht-accent">class option</span>}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] text-ht-muted">
        picked {picked.size}{cls ? ` · class target ${cls.skillNumber}` : ''} — background/house picks beyond the target are fine
      </div>
    </div>
  );
}
