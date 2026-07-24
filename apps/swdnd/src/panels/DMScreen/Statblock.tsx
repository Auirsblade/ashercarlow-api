// apps/swdnd/src/panels/DMScreen/Statblock.tsx — essentials statblock pane.
import RollableText from '../../components/RollableText';
import type { MonsterEntryText, MonsterView } from '../../lib/monsters';

const mod = (v: number | null): string => {
  if (v === null) return '—';
  const m = Math.floor((v - 10) / 2);
  return `${v} (${m >= 0 ? '+' : ''}${m})`;
};

function EntryGroup({ label, entries }: { label: string; entries: MonsterEntryText[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-3">
      <div className="ht-label mb-1">{label}</div>
      <div className="flex flex-col gap-2">
        {entries.map((e, i) => (
          <div key={`${e.name}-${i}`} className="text-[11px]">
            <span className="font-bold text-ht-bright">{e.name}. </span>
            <RollableText className="whitespace-pre-line text-ht-text" text={e.text} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Statblock({ view }: { view: MonsterView }) {
  const abilities: Array<[string, number | null]> = [
    ['STR', view.abilities.str], ['DEX', view.abilities.dex], ['CON', view.abilities.con],
    ['INT', view.abilities.int], ['WIS', view.abilities.wis], ['CHA', view.abilities.cha],
  ];
  return (
    <div>
      <div className="ht-name text-sm font-bold text-ht-bright">{view.name}</div>
      <div className="text-[10px] text-ht-muted">
        {[view.size, view.type].filter(Boolean).join(' ')} · CR {view.crLabel}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span><span className="ht-label">AC</span> {view.ac ?? '—'}</span>
        <span>
          <span className="ht-label">HP</span> {view.hp ?? '—'}
          {view.hpFormula ? <span className="text-ht-muted"> (<RollableText text={view.hpFormula} />)</span> : null}
        </span>
        <span><span className="ht-label">Speed</span> {view.speed || '—'}</span>
      </div>

      <div className="mt-2 grid grid-cols-6 gap-1 text-center text-[10px]">
        {abilities.map(([k, v]) => (
          <div key={k} className="rounded border border-ht-line p-1">
            <div className="ht-label">{k}</div>
            <div className="text-ht-bright">{mod(v)}</div>
          </div>
        ))}
      </div>

      <EntryGroup label="Traits" entries={view.traits} />
      <EntryGroup label="Actions" entries={view.actions} />
      <EntryGroup label="Powers" entries={view.powers} />
    </div>
  );
}
