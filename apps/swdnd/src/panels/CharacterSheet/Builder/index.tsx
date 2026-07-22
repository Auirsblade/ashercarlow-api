// apps/swdnd/src/panels/CharacterSheet/Builder/index.tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBuilder } from '../../../hooks/useBuilder';
import { factionStyle } from '../../../lib/faction';
import type { StepKey } from '../../../lib/validation';
import StepRail from './StepRail';
import SpeciesStep from './steps/Species';
import BackgroundStep from './steps/Background';
import ClassStep from './steps/Class';
import SkillsStep from './steps/Skills';
import AbilitiesStep from './steps/Abilities';
import FeatsStep from './steps/Feats';
import EquipmentStep from './steps/Equipment';
import PowersStep from './steps/Powers';

export default function Builder({ characterId }: { characterId: string }) {
  const b = useBuilder(characterId);
  const [active, setActive] = useState<StepKey>('species');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const sheetHref = `/sheet/${characterId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  if (b.loading) return <div className="p-6 font-mono text-ht-muted">Loading builder…</div>;
  if (!b.build || !b.derived || !b.ref || !b.status) {
    return <div className="p-6 font-mono text-red-400">{b.error ?? 'Character not found'}</div>;
  }
  if (!b.canEdit) {
    return (
      <div className="p-6 font-mono text-ht-muted">
        Read-only link — the builder needs an owner token. <a className="text-ht-accent" href={sheetHref}>◂ view the sheet</a>
      </div>
    );
  }

  return (
    <div className="@container ht-screen min-h-screen p-3 font-mono text-ht-text" style={factionStyle(b.build.identity.alignment)}>
      {b.error && (
        <div className="mb-2 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 text-[11px] text-red-300">
          ⚠ {b.error} — changes may not be saved
        </div>
      )}
      <div className="ht-glow mb-3 flex flex-wrap items-center gap-3 rounded-md p-3">
        <input
          className="ht-name w-56 border-b border-ht-line bg-transparent text-sm font-bold outline-none"
          value={b.build.identity.name}
          placeholder="character name…"
          onChange={(e) => b.dispatch({ t: 'setName', name: e.target.value })}
        />
        <span className="text-[10px] text-ht-muted">building level 1</span>
        <span className="ml-auto text-[10px] text-ht-muted">
          {b.saving ? 'saving…' : 'auto-saved ✓'} · <a className="text-ht-accent" href={sheetHref}>◂ back to sheet</a>
        </span>
      </div>

      <div className="flex flex-col gap-3 @lg:flex-row">
        <StepRail status={b.status} active={active} houseRuled={b.build.houseRuled ?? []} onSelect={setActive} />
        <div className="min-w-0 flex-1">
          {active === 'species' && <SpeciesStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'background' && <BackgroundStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'class' && <ClassStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'skills' && <SkillsStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'abilities' && (
            <AbilitiesStep build={b.build} derived={b.derived} editable={b.canEdit} dispatch={b.dispatch} />
          )}
          {active === 'feats' && <FeatsStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'equipment' && <EquipmentStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'powers' && (
            <PowersStep build={b.build} derived={b.derived} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />
          )}
        </div>
      </div>
    </div>
  );
}
