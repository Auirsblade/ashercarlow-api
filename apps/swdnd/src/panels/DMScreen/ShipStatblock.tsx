// apps/swdnd/src/panels/DMScreen/ShipStatblock.tsx — a stock ship rendered
// through the real engine: the pack row is converted to a ShipBuild and fed to
// computeShip, so the browser shows exactly what "add to fleet" would create.
import { useMemo } from 'react';
import { computeShip } from '../../lib/shipRules';
import type { ShipReferenceData } from '../../lib/shipRules/types';
import { stockToShipBuild, type ShipRefIndex, type StockShipView } from '../../lib/starships';

const MOUNT_LABEL: Record<string, string> = {
  'fixed-forward': 'fwd', 'fixed-aft': 'aft', 'fixed-port': 'port',
  'fixed-starboard': 'stbd', turret: 'turret',
};

const abilityMod = (v: number): string => {
  const m = Math.floor((v - 10) / 2);
  return `${v} (${m >= 0 ? '+' : ''}${m})`;
};

export default function ShipStatblock({
  view, shipRef, idx,
}: { view: StockShipView; shipRef: ShipReferenceData; idx: ShipRefIndex }) {
  const build = useMemo(() => stockToShipBuild(view, idx), [view, idx]);
  const derived = useMemo(() => computeShip(build, shipRef), [build, shipRef]);

  const abilities: Array<[string, number]> = [
    ['STR', build.abilities.base.str], ['DEX', build.abilities.base.dex], ['CON', build.abilities.base.con],
    ['INT', build.abilities.base.int], ['WIS', build.abilities.base.wis], ['CHA', build.abilities.base.cha],
  ];
  const weapons = build.equipment.filter((e) => e.kind === 'weapon');
  const systems = build.equipment.filter((e) => e.kind !== 'weapon');
  const refName = (table: Record<string, string>, ref: string) => table[ref] ?? `(unknown ${ref})`;
  // Same used/Max idiom as the builder (Weapons.tsx, Modifications.tsx) — most
  // stock ships run over on at least one budget, and this pane's contract is
  // "exactly what add-to-fleet creates," so the overage should show here too.
  const overBudget = derived.hardpointsUsed > derived.hardpointsMax
    || derived.modSlotsUsed > derived.modSlotsMax
    || derived.suitesUsed > derived.suitesMax;

  return (
    <div>
      <div className="ht-name text-sm font-bold text-ht-bright">{view.name}</div>
      <div className="text-[10px] text-ht-muted">
        {[view.sizeName, `tier ${view.tier}`].filter(Boolean).join(' · ')}
        {view.source ? ` · ${view.source}` : ''}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span><span className="ht-label">AC</span> {derived.armorClass}</span>
        <span><span className="ht-label">Hull</span> {derived.maxHull}</span>
        <span><span className="ht-label">Shields</span> {derived.maxShields}</span>
        <span><span className="ht-label">Speed</span> {derived.speed}</span>
        <span><span className="ht-label">Turn</span> {derived.turnSpeed}</span>
      </div>

      <div className={`mt-1 text-[10px] ${overBudget ? 'text-yellow-300' : 'text-ht-muted'}`}>
        {derived.hardpointsUsed}/{derived.hardpointsMax} hardpoints · {derived.modSlotsUsed}/{derived.modSlotsMax} slots · {derived.suitesUsed}/{derived.suitesMax} suite
        {overBudget && ' — over budget'}
      </div>

      <div className="mt-2 grid grid-cols-6 gap-1 text-center text-[10px]">
        {abilities.map(([k, v]) => (
          <div key={k} className="rounded border border-ht-line p-1">
            <div className="ht-label">{k}</div>
            <div className="text-ht-bright">{abilityMod(v)}</div>
          </div>
        ))}
      </div>

      {weapons.length > 0 && (
        <section className="mt-3">
          <div className="ht-label mb-1">Weapons</div>
          <div className="flex flex-col gap-1 text-[11px]">
            {weapons.map((w) => (
              <div key={w.id}>
                <span className="text-ht-bright">{refName(idx.weapons, w.ref)}</span>
                <span className="text-ht-muted"> · {MOUNT_LABEL[w.mount ?? 'turret'] ?? w.mount}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {systems.length > 0 && (
        <section className="mt-3">
          <div className="ht-label mb-1">Systems</div>
          <div className="flex flex-wrap gap-1 text-[10px]">
            {systems.map((e) => (
              <span key={e.id} className="rounded border border-ht-line px-1 py-0.5">
                <span className="text-ht-bright">
                  {refName(e.kind === 'armor' || e.kind === 'shield' ? idx.armor : idx.equipment, e.ref)}
                </span>
                <span className="text-ht-muted"> · {e.kind}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {build.modifications.length > 0 && (
        <section className="mt-3">
          <div className="ht-label mb-1">Modifications ({build.modifications.length})</div>
          <div className="flex flex-wrap gap-1 text-[10px] text-ht-text">
            {build.modifications.map((ref, i) => (
              <span key={`${ref}-${i}`} className="rounded border border-ht-line px-1 py-0.5">
                {refName(idx.modifications, ref)}
              </span>
            ))}
          </div>
        </section>
      )}

      {view.hull === null && (
        <div className="mt-3 text-[10px] text-ht-muted">
          This ship publishes no hull total — pools start at the derived maxima.
        </div>
      )}
    </div>
  );
}
