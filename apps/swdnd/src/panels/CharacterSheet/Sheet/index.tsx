// apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx
import { useCharacterSheet } from '../../../hooks/useCharacterSheet';
import { factionStyle } from '../../../lib/faction';
import { rollD20 } from '../../../lib/dice';
import CoreBar from './CoreBar';
import Abilities from './Abilities';
import Skills from './Skills';
import Combat from './Combat';
import Gear from './Gear';
import Features from './Features';
import Powers from './Powers';
import RollToast, { useRolls } from './RollToast';
import TabbedShell from './TabbedShell';

export default function Sheet({ characterId }: { characterId: string }) {
  const s = useCharacterSheet(characterId);
  const { rolls, pushRoll } = useRolls();

  if (s.loading) return <div className="p-6 font-mono text-ht-muted">Loading sheet…</div>;
  if (s.error) return <div className="p-6 font-mono text-red-400">{s.error}</div>;
  if (!s.build || !s.derived || !s.ref || !s.play) return null;

  const roll = (label: string, mod: number) => {
    const r = rollD20(mod);
    pushRoll(label, `d20 ${r.kept} ${mod >= 0 ? '+' : ''}${mod}`, r.total);
  };

  const colAbilities = (
    <div className="flex flex-col gap-3">
      <Abilities derived={s.derived} onRoll={roll} />
      <Skills derived={s.derived} onRoll={roll} />
    </div>
  );
  const colCombat = (
    <div className="flex flex-col gap-3">
      <Combat build={s.build} derived={s.derived} ref={s.ref} onRoll={roll} />
      <Gear build={s.build} ref={s.ref} />
      <Features build={s.build} />
    </div>
  );
  const colPowers = (
    <Powers build={s.build} derived={s.derived} ref={s.ref} editable={s.canEdit}
      playForceSpent={s.play.forcePointsSpent} playTechSpent={s.play.techPointsSpent} dispatch={s.dispatch} />
  );

  return (
    <div className="@container min-h-screen bg-ht-bg p-3 text-ht-text" style={factionStyle(s.build.identity.alignment)}>
      <CoreBar build={s.build} derived={s.derived} play={s.play} editable={s.canEdit} dispatch={s.dispatch} />

      {/* Wide: 3 columns */}
      <div className="mt-3 hidden gap-3 @lg:grid @lg:grid-cols-3">
        {colAbilities}{colCombat}{colPowers}
      </div>

      {/* Narrow / medium: tabs */}
      <div className="@lg:hidden">
        <TabbedShell tabs={[
          { key: 'combat', label: 'Combat', content: colCombat },
          { key: 'powers', label: 'Powers', content: colPowers },
          { key: 'skills', label: 'Skills', content: colAbilities },
        ]} />
      </div>

      <RollToast rolls={rolls} />
    </div>
  );
}
