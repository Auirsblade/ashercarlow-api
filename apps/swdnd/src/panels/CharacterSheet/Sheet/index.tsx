// apps/swdnd/src/panels/CharacterSheet/Sheet/index.tsx
import { useSearchParams } from 'react-router-dom';
import { useCharacterSheet } from '../../../hooks/useCharacterSheet';
import { factionStyle } from '../../../lib/faction';
import { rollD20 } from '../../../lib/dice';
import { postRoll } from '../../../lib/rolls';
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
  const [searchParams] = useSearchParams();

  if (s.loading) return <div className="p-6 font-mono text-ht-muted">Loading sheet…</div>;
  // Only a LOAD failure is fatal; a failed save renders as a banner over live data.
  if (!s.build || !s.derived || !s.ref || !s.play) {
    return <div className="p-6 font-mono text-red-400">{s.error ?? 'Character not found'}</div>;
  }

  const characterName = s.build.identity.name;
  const roll = (label: string, mod: number) => {
    const r = rollD20(mod);
    pushRoll(label, `d20 ${r.kept} ${mod >= 0 ? '+' : ''}${mod}`, r.total);
    // Fire-and-forget into the campaign roll log — a failed POST never blocks the local toast.
    if (s.dto) {
      void postRoll(s.dto.campaign_id, {
        roller: characterName || 'Character',
        label,
        formula: mod === 0 ? '1d20' : `1d20${mod >= 0 ? '+' : ''}${mod}`,
        rolls: [{ sides: 20, value: r.kept }],
        total: r.total,
      }, searchParams.get('token')).catch(() => { /* anon viewer or offline: local roll still shows */ });
    }
  };

  const castingAbility = s.derived.casting.force.ability ?? s.derived.casting.tech.ability;
  const colAbilities = (
    <div className="flex flex-col gap-3">
      <Abilities derived={s.derived} highlight={castingAbility} onRoll={roll} />
      <Skills derived={s.derived} onRoll={roll} />
    </div>
  );
  const colCombat = (
    <div className="flex flex-col gap-3">
      <Combat build={s.build} derived={s.derived} ref={s.ref} onRoll={roll} />
      <Gear build={s.build} ref={s.ref} />
      <Features build={s.build} ref={s.ref} />
    </div>
  );
  const colPowers = (
    <Powers build={s.build} derived={s.derived} ref={s.ref} editable={s.canEdit}
      playForceSpent={s.play.forcePointsSpent} playTechSpent={s.play.techPointsSpent}
      playSuperioritySpent={s.play.superiorityDiceSpent} dispatch={s.dispatch} />
  );

  return (
    <div className="@container ht-screen min-h-screen p-3 text-ht-text" style={factionStyle(s.build.identity.alignment)}>
      {s.error && (
        <div className="mb-2 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 font-mono text-[11px] text-red-300">
          ⚠ {s.error} — changes may not be saved
        </div>
      )}
      <CoreBar characterId={characterId} build={s.build} derived={s.derived} ref={s.ref} play={s.play} editable={s.canEdit} dispatch={s.dispatch} campaignId={s.dto?.campaign_id ?? null} />

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
