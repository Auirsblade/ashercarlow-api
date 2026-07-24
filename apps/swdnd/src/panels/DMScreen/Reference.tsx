// apps/swdnd/src/panels/DMScreen/Reference.tsx — three-category quick lookup.
import { useState } from 'react';
import { searchEntries, type RefEntry } from '../../lib/refSearch';
import type { PowerEntry } from '../../hooks/useDmScreen';

const CATEGORIES = ['conditions', 'powers', 'weapon properties'] as const;
type Category = (typeof CATEGORIES)[number];

function RefLookup({ entries, meta }: { entries: RefEntry[]; meta?: (e: RefEntry) => string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (entries.length === 0) return <div className="text-[11px] text-ht-muted">No matches.</div>;
  return (
    <div className="max-h-[440px] overflow-y-auto">
      {entries.map((e) => (
        <div key={e.id} className="border-b border-ht-line/50">
          <button
            type="button"
            className="flex w-full items-baseline gap-2 px-1 py-1 text-left text-[11px]"
            onClick={() => setOpenId((cur) => (cur === e.id ? null : e.id))}
          >
            <span className="text-ht-bright">{e.name}</span>
            {meta && <span className="ml-auto shrink-0 text-[10px] text-ht-muted">{meta(e)}</span>}
          </button>
          {openId === e.id && (
            <div className="whitespace-pre-line px-1 pb-2 text-[11px] text-ht-text">{e.text}</div>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  conditions: RefEntry[];
  powers: PowerEntry[];
  weaponProperties: RefEntry[];
}

export default function Reference({ conditions, powers, weaponProperties }: Props) {
  const [category, setCategory] = useState<Category>('conditions');
  const [q, setQ] = useState('');
  const [castType, setCastType] = useState('');
  const [level, setLevel] = useState('');

  const filteredPowers = searchEntries(powers, q).filter((p) =>
    (!castType || p.castType === castType) && (level === '' || p.level === Number(level)));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={`ht-step ${category === c ? 'ht-tile-active' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
        <input
          className="w-40 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {category === 'powers' && (
          <>
            <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={castType} onChange={(e) => setCastType(e.target.value)}>
              <option value="">force + tech</option>
              <option value="force">force</option>
              <option value="tech">tech</option>
            </select>
            <select className="border-b border-ht-line bg-transparent text-ht-text outline-none" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">any level</option>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n === 0 ? 'at-will' : `level ${n}`}</option>)}
            </select>
          </>
        )}
      </div>

      {category === 'conditions' && <RefLookup entries={searchEntries(conditions, q)} />}
      {category === 'weapon properties' && <RefLookup entries={searchEntries(weaponProperties, q)} />}
      {category === 'powers' && (
        <RefLookup
          entries={filteredPowers}
          meta={(e) => {
            const p = e as PowerEntry;
            return `${p.castType} · ${p.level === 0 ? 'at-will' : `L${p.level}`}`;
          }}
        />
      )}
    </div>
  );
}
