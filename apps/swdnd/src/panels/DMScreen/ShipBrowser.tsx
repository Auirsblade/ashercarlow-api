// apps/swdnd/src/panels/DMScreen/ShipBrowser.tsx — stock-ship search/filter list
// + statblock pane with add-to-fleet, spawn and add-to-encounter controls.
import { useMemo, useState } from 'react';
import {
  filterStockShips, shipRefIndex, stockShipSizes, type StockShipView,
} from '../../lib/starships';
import type { ShipReferenceData } from '../../lib/shipRules/types';
import type { EncounterDto } from '../../lib/encounters';
import ShipStatblock from './ShipStatblock';

const TIERS = [0, 1, 2, 3, 4, 5] as const;

interface Props {
  stock: StockShipView[];
  shipRef: ShipReferenceData | null;
  encounters: EncounterDto[];
  onAddToFleet: (view: StockShipView) => void;
  onSpawn: (view: StockShipView, count: number) => void;
  onAddToEncounter: (encounterId: string, stockShipRef: string) => void;
}

export default function ShipBrowser({ stock, shipRef, encounters, onAddToFleet, onSpawn, onAddToEncounter }: Props) {
  const [q, setQ] = useState('');
  const [size, setSize] = useState('');
  const [tierMin, setTierMin] = useState('');
  const [tierMax, setTierMax] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [encId, setEncId] = useState('');

  const sizes = useMemo(() => stockShipSizes(stock), [stock]);
  const filtered = useMemo(() => filterStockShips(stock, {
    q,
    size: size || undefined,
    tierMin: tierMin === '' ? undefined : Number(tierMin),
    tierMax: tierMax === '' ? undefined : Number(tierMax),
  }), [stock, q, size, tierMin, tierMax]);
  const selected = stock.find((s) => s.id === selectedId) ?? null;
  const idx = useMemo(() => (shipRef ? shipRefIndex(shipRef) : null), [shipRef]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 @[700px]:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 text-[11px]">
          <input
            className="w-40 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
            placeholder="search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">any size</option>
            {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={tierMin} onChange={(e) => setTierMin(e.target.value)}>
            <option value="">tier min</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={tierMax} onChange={(e) => setTierMax(e.target.value)}>
            <option value="">tier max</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-[10px] text-ht-muted">{filtered.length}/{stock.length}</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto @[700px]:min-h-0 @[700px]:max-h-none @[700px]:flex-1">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`flex w-full items-baseline gap-2 border-b border-ht-line/50 px-1 py-1 text-left text-[11px] ${s.id === selectedId ? 'ht-tile-active' : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              <span className="text-ht-bright">{s.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-ht-muted">
                tier {s.tier}{s.sizeName ? ` · ${s.sizeName}` : ''}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-2 text-[11px] text-ht-muted">No matches.</div>}
        </div>
      </div>

      <div className="ht-panel min-w-0 flex-1 p-3 @[700px]:max-w-[46%] @[700px]:min-h-0 @[700px]:overflow-y-auto">
        {selected && shipRef && idx ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <button type="button" className="ht-step" onClick={() => onAddToFleet(selected)}>add to fleet</button>
              <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>×{n}</option>)}
              </select>
              <button type="button" className="ht-step" onClick={() => onSpawn(selected, count)}>spawn to map</button>
              {encounters.length > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <select className="max-w-[140px] border-b border-ht-line bg-transparent text-ht-text outline-none" value={encId} onChange={(e) => setEncId(e.target.value)}>
                    <option value="">encounter…</option>
                    {encounters.map((enc) => <option key={enc.id} value={enc.id}>{enc.name}</option>)}
                  </select>
                  <button type="button" className="ht-step" onClick={() => encId && onAddToEncounter(encId, selected.id)}>+ add</button>
                </span>
              )}
            </div>
            <ShipStatblock view={selected} shipRef={shipRef} idx={idx} />
          </>
        ) : (
          <div className="text-[11px] text-ht-muted">
            {shipRef ? 'Select a ship to view its statblock.' : 'Ship reference still loading…'}
          </div>
        )}
      </div>
    </div>
  );
}
