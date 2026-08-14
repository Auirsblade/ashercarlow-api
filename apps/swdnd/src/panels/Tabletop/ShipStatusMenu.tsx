// apps/swdnd/src/panels/Tabletop/ShipStatusMenu.tsx — space vocabulary for a
// ship token. Writes land on the SHIP document (ShipPlayState), never on
// token.conditions_json, so every token of that ship and the ShipSheet agree.
import { conditionColor } from '../../lib/rings';
import { MAX_SYSTEM_DAMAGE, SHIP_CONDITION_OPTIONS } from '../../lib/shipTokens';
import type { ShipVitals } from '../../lib/shipVitals';

export default function ShipStatusMenu({
  name, vitals, onToggle, onSystemDamage,
}: {
  name: string;
  vitals: ShipVitals | null;
  onToggle: (condition: string) => void;
  onSystemDamage: (value: number) => void;
}) {
  const active = new Set(vitals?.conditions ?? []);
  const sys = vitals?.systemDamage ?? 0;
  return (
    <>
      <div className="ht-label px-2 py-1">{name} · ship status</div>
      {!vitals && <div className="px-2 py-1 text-[10px] text-ht-muted">loading ship…</div>}
      <div className="max-h-56 overflow-y-auto">
        {SHIP_CONDITION_OPTIONS.map((c) => (
          <button
            key={c} type="button" disabled={!vitals}
            className="flex w-full items-center gap-2 rounded px-2 py-0.5 text-left hover:bg-white/5 disabled:opacity-40"
            onClick={() => onToggle(c)}
          >
            <span style={{ color: conditionColor(c) }}>{active.has(c) ? '◈' : '○'}</span>
            <span className={active.has(c) ? 'text-ht-bright' : 'text-ht-text'}>{c}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-ht-line px-2 py-1">
        <span className="text-[10px] text-ht-muted">system damage</span>
        <button
          type="button" className="ht-step" disabled={!vitals || sys <= 0}
          title="one less damaged system" onClick={() => onSystemDamage(sys - 1)}
        >
          −
        </button>
        <span className="text-ht-bright">{sys}</span>
        <button
          type="button" className="ht-step" disabled={!vitals || sys >= MAX_SYSTEM_DAMAGE}
          title="one more damaged system" onClick={() => onSystemDamage(sys + 1)}
        >
          +
        </button>
        <span className="text-[10px] text-ht-muted">/ {MAX_SYSTEM_DAMAGE}</span>
      </div>
    </>
  );
}
