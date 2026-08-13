// apps/swdnd/src/panels/ShipSheet/Builder/index.tsx
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useShipBuilder } from '../../../hooks/useShipBuilder';
import type { ShipStepKey } from '../../../lib/shipValidation';
import ShipStepRail from './ShipStepRail';
import SizeStep from './steps/Size';
import TierStep from './steps/Tier';

export default function ShipBuilder({ shipId }: { shipId: string }) {
  const b = useShipBuilder(shipId);
  const [active, setActive] = useState<ShipStepKey>('size');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const sheetHref = `/ship/${shipId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  if (b.loading) return <div className="p-6 font-mono text-ht-muted">Loading ship builder…</div>;
  if (!b.build || !b.derived || !b.ref || !b.status) {
    return <div className="p-6 font-mono text-red-400">{b.error ?? 'Starship not found'}</div>;
  }
  if (!b.canEdit) {
    return (
      <div className="p-6 font-mono text-ht-muted">
        Read-only — the ship builder needs the admin session or a crew member's token.{' '}
        <Link className="text-ht-accent" to={sheetHref}>◂ view the ship</Link>
      </div>
    );
  }

  const isHouseRuled = (b.build.houseRuled ?? []).includes(active);

  return (
    <div className="@container ht-screen flex h-full min-h-0 flex-col p-3 font-mono text-ht-text">
      {b.error && (
        <div className="mb-2 shrink-0 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 text-[11px] text-red-300">
          ⚠ {b.error} — changes may not be saved
        </div>
      )}
      <div className="ht-glow mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-md p-3">
        <input
          className="ht-name w-56 border-b border-ht-line bg-transparent text-sm font-bold outline-none"
          value={b.build.identity.name}
          placeholder="ship name…"
          onChange={(e) => b.dispatch({ t: 'setName', name: e.target.value })}
        />
        <span className="text-[10px] text-ht-muted">tier {b.derived.tier}</span>
        <button
          type="button"
          className={`ht-step text-[10px] ${isHouseRuled ? 'ht-tile-active' : ''}`}
          title="house-rule this step: silence its budget warning"
          onClick={() => b.dispatch({ t: 'toggleHouseRule', step: active })}
        >
          ⌂ house rule {isHouseRuled ? 'on' : 'off'}
        </button>
        <span className="ml-auto text-[10px] text-ht-muted">
          {b.saving ? 'saving…' : 'auto-saved ✓'} · <Link className="text-ht-accent" to={sheetHref}>◂ back to ship</Link>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 @lg:flex-row">
        <ShipStepRail status={b.status} active={active} houseRuled={b.build.houseRuled ?? []} onSelect={setActive} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {active === 'size' && <SizeStep build={b.build} ref={b.ref} editable={b.canEdit} dispatch={b.dispatch} />}
          {active === 'tier' && <TierStep build={b.build} derived={b.derived} editable={b.canEdit} dispatch={b.dispatch} />}
          {/* hull / weapons / equipment / modifications steps land in Tasks 25-26 */}
        </div>
      </div>
    </div>
  );
}
