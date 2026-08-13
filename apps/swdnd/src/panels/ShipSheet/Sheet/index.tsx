// apps/swdnd/src/panels/ShipSheet/Sheet/index.tsx
import { useSearchParams } from 'react-router-dom';
import { useShipSheet } from '../../../hooks/useShipSheet';
import { parseFormula, rollD20, rollFormula } from '../../../lib/dice';
import { postRoll } from '../../../lib/rolls';
import RollToast, { useRolls } from '../../CharacterSheet/Sheet/RollToast';
import TabbedShell from '../../CharacterSheet/Sheet/TabbedShell';
import ShipCoreBar from './ShipCoreBar';
import ShipWeapons from './ShipWeapons';
import CrewStrip from './CrewStrip';

export default function ShipSheetView({ shipId }: { shipId: string }) {
  const s = useShipSheet(shipId);
  const { rolls, pushRoll } = useRolls();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  if (s.loading) return <div className="p-6 font-mono text-ht-muted">Loading ship…</div>;
  // Only a LOAD failure is fatal; a failed save renders as a banner over live data.
  if (!s.build || !s.derived || !s.play || !s.ref) {
    return <div className="p-6 font-mono text-red-400">{s.error ?? 'Starship not found'}</div>;
  }

  const derived = s.derived;
  const play = s.play;
  const shipName = s.build.identity.name || 'Starship';

  const log = (label: string, formula: string, dice: { sides: number; value: number }[], total: number) => {
    pushRoll(label, formula, total);
    // Fire-and-forget into the campaign roll log — a failed POST never blocks the local toast.
    if (s.dto) {
      void postRoll(s.dto.campaign_id, { roller: shipName, label, formula, rolls: dice, total }, token)
        .catch(() => { /* anon viewer or offline: local roll still shows */ });
    }
  };

  const roll = (label: string, mod: number) => {
    const r = rollD20(mod);
    log(label, mod === 0 ? '1d20' : `1d20${mod >= 0 ? '+' : ''}${mod}`, [{ sides: 20, value: r.kept }], r.total);
  };

  const rollDamage = (label: string, formula: string) => {
    const terms = parseFormula(formula);
    if (!terms) return;
    const r = rollFormula(terms);
    log(label, r.formula, r.rolls, r.total);
  };

  // useShipSheet's dispatch closes over `play` (a plain setState, not a
  // functional updater): two dispatch() calls issued back-to-back in the same
  // handler would both compute from that same stale play, and the first
  // write would be silently dropped. Patch and Regenerate each need
  // "spend the die" + "apply the result" together, so both go through a
  // single compound action (lib/shipPlayState.ts: patchHull / regenerateShields)
  // instead of two sequential dispatches.
  const onPatchHull = () => {
    // Patch rolls the hull die — the result lands in the roll log — then the
    // compound action spends the die and applies that rolled total together.
    const mod = derived.abilities.con.mod;
    const formula = mod === 0 ? `1d${derived.hullDice.die}` : `1d${derived.hullDice.die}${mod >= 0 ? '+' : ''}${mod}`;
    const terms = parseFormula(formula);
    if (!terms) return;
    const r = rollFormula(terms);
    log('Patch hull', r.formula, r.rolls, r.total);
    s.dispatch({ t: 'patchHull', rolled: Math.max(0, r.total) });
  };
  const onRegenerateShields = () => {
    // Regenerate is a fixed rate — the die is expended unrolled, never rolled.
    s.dispatch({ t: 'regenerateShields' });
    pushRoll('Regenerate shields', `+${derived.shieldRegen} (fixed, not rolled)`, derived.shieldRegen);
  };

  const colWeapons = (
    <div className="flex flex-col gap-3">
      <ShipWeapons derived={derived} play={play} editable={s.canEdit} dispatch={s.dispatch}
        onRoll={roll} onRollDamage={rollDamage} />
      <CrewStrip shipId={shipId} crew={s.crew} />
    </div>
  );
  const colNotes = (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Notes</div>
      <textarea
        className="h-40 w-full resize-y bg-transparent text-ht-text outline-none"
        placeholder="damage reports, cargo, the smell…"
        disabled={!s.canEdit}
        value={play.notes}
        onChange={(e) => s.dispatch({ t: 'setNotes', notes: e.target.value })}
      />
    </div>
  );

  return (
    <div className="@container ht-screen min-h-screen p-3 text-ht-text">
      {s.error && (
        <div className="mb-2 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 font-mono text-[11px] text-red-300">
          ⚠ {s.error} — changes may not be saved
        </div>
      )}
      <ShipCoreBar
        shipId={shipId} build={s.build} derived={derived} play={play}
        editable={s.canEdit} campaignId={s.dto?.campaign_id ?? null}
        dispatch={s.dispatch} onPatchHull={onPatchHull} onRegenerateShields={onRegenerateShields}
      />

      {/* Wide: two columns */}
      <div className="mt-3 hidden gap-3 @lg:grid @lg:grid-cols-2">
        {colWeapons}{colNotes}
      </div>

      {/* Narrow / medium: tabs */}
      <div className="@lg:hidden">
        <TabbedShell tabs={[
          { key: 'weapons', label: 'Weapons', content: colWeapons },
          { key: 'notes', label: 'Notes', content: colNotes },
        ]} />
      </div>

      <RollToast rolls={rolls} />
    </div>
  );
}
