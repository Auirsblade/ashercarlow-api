// apps/swdnd/src/panels/DMScreen/MonsterBrowser.tsx — search/filter list +
// statblock pane with spawn and add-to-encounter controls.
import { useMemo, useState } from 'react';
import { filterMonsters, monsterTypes, type MonsterView } from '../../lib/monsters';
import type { EncounterDto } from '../../lib/encounters';
import Statblock from './Statblock';

const CR_STEPS = [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20] as const;
const crText = (v: number) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' } as Record<number, string>)[v] ?? String(v);

interface Props {
  monsters: MonsterView[];
  encounters: EncounterDto[];
  onSpawn: (view: MonsterView, count: number) => void;
  onAddToEncounter: (encounterId: string, monsterId: string) => void;
}

export default function MonsterBrowser({ monsters, encounters, onSpawn, onAddToEncounter }: Props) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [crMin, setCrMin] = useState('');
  const [crMax, setCrMax] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [encId, setEncId] = useState('');

  const types = useMemo(() => monsterTypes(monsters), [monsters]);
  const filtered = useMemo(() => filterMonsters(monsters, {
    q,
    type: type || undefined,
    crMin: crMin === '' ? undefined : Number(crMin),
    crMax: crMax === '' ? undefined : Number(crMax),
  }), [monsters, q, type, crMin, crMax]);
  const selected = monsters.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3 @[700px]:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <input
            className="w-40 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
            placeholder="search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">any type</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={crMin} onChange={(e) => setCrMin(e.target.value)}>
            <option value="">CR min</option>
            {CR_STEPS.map((v) => <option key={v} value={v}>{crText(v)}</option>)}
          </select>
          <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={crMax} onChange={(e) => setCrMax(e.target.value)}>
            <option value="">CR max</option>
            {CR_STEPS.map((v) => <option key={v} value={v}>{crText(v)}</option>)}
          </select>
          <span className="text-[10px] text-ht-muted">{filtered.length}/{monsters.length}</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`flex w-full items-baseline gap-2 border-b border-ht-line/50 px-1 py-1 text-left text-[11px] ${m.id === selectedId ? 'ht-tile-active' : ''}`}
              onClick={() => setSelectedId(m.id)}
            >
              <span className="text-ht-bright">{m.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-ht-muted">
                CR {m.crLabel}{m.type ? ` · ${m.type}` : ''}{m.size ? ` · ${m.size}` : ''}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-2 text-[11px] text-ht-muted">No matches.</div>}
        </div>
      </div>

      <div className="ht-panel min-w-0 flex-1 p-3 @[700px]:max-w-[46%]">
        {selected ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>×{n}</option>)}
              </select>
              <button type="button" className="ht-step" onClick={() => onSpawn(selected, count)}>spawn to map</button>
              {encounters.length > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <select className="max-w-[140px] border-b border-ht-line bg-transparent text-ht-text outline-none" value={encId} onChange={(e) => setEncId(e.target.value)}>
                    <option value="">encounter…</option>
                    {encounters.map((enc) => <option key={enc.id} value={enc.id}>{enc.name}</option>)}
                  </select>
                  <button
                    type="button"
                    className="ht-step"
                    onClick={() => encId && onAddToEncounter(encId, selected.id)}
                  >
                    + add
                  </button>
                </span>
              )}
            </div>
            <Statblock view={selected} />
          </>
        ) : (
          <div className="text-[11px] text-ht-muted">Select a monster to view its statblock.</div>
        )}
      </div>
    </div>
  );
}
