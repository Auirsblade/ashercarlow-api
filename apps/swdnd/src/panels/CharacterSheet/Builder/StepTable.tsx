// apps/swdnd/src/panels/CharacterSheet/Builder/StepTable.tsx
import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  flex?: number;
  value: (item: T) => string | number;
}

interface Props<T> {
  items: T[];
  columns: Column<T>[];
  idOf: (item: T) => string;
  searchText: (item: T) => string;
  detail: (item: T) => ReactNode;
  isSelected: (item: T) => boolean;
  onSelect: (item: T) => void;
  selectLabel?: (item: T) => string;
  /** Non-null → row is dimmed, reason shown in the detail pane, selection hidden. */
  disabledReason?: (item: T) => string | null;
  /** Optional strip above the table (counters, filters, unlock toggle). */
  header?: ReactNode;
  editable: boolean;
}

export default function StepTable<T>({
  items, columns, idOf, searchText, detail, isSelected, onSelect, selectLabel, disabledReason, header, editable,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? '');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const col = columns.find((c) => c.key === sortKey) ?? columns[0];
    const filtered = q ? items.filter((i) => searchText(i).toLowerCase().includes(q)) : [...items];
    // Selected rows pin to the top; the rest sort by the active column.
    return filtered.sort((a, b) => {
      const sel = Number(isSelected(b)) - Number(isSelected(a));
      if (sel !== 0) return sel;
      const av = col.value(a);
      const bv = col.value(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return cmp * sortDir;
    });
  }, [items, columns, query, sortKey, sortDir, searchText, isSelected]);

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 text-[11px]">
      {header}
      <input
        className="ht-panel w-full px-2 py-1 text-ht-bright outline-none placeholder:text-ht-muted"
        placeholder={`⌕ search ${items.length} entries…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ht-label flex gap-2 px-2">
        {columns.map((c) => (
          <button key={c.key} type="button" style={{ flex: c.flex ?? 1 }} className="text-left"
            onClick={() => toggleSort(c.key)}>
            {c.label}{sortKey === c.key ? (sortDir === 1 ? ' ▴' : ' ▾') : ''}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {visible.map((item) => {
          const id = idOf(item);
          const selected = isSelected(item);
          const open = expanded === id;
          const reason = disabledReason?.(item) ?? null;
          return (
            <div key={id} className={`${selected || open ? 'ht-glow' : 'ht-panel'}${reason ? ' opacity-60' : ''}`}>
              <button type="button" className="flex w-full gap-2 px-2 py-1 text-left"
                onClick={() => setExpanded(open ? null : id)}>
                {columns.map((c, i) => (
                  <span key={c.key} style={{ flex: c.flex ?? 1 }}
                    className={i === 0 ? (selected ? 'text-ht-bright' : 'text-ht-text') : 'text-ht-muted'}>
                    {i === 0 && selected ? '◈ ' : ''}{c.value(item)}{i === 0 && open ? ' ▾' : ''}
                  </span>
                ))}
              </button>
              {!open && reason && (
                <div className="px-2 pb-1 text-[9px] text-yellow-300/80">⚠ {reason}</div>
              )}
              {open && (
                <div className="border-t border-ht-line px-3 py-2">
                  <div className="whitespace-pre-line text-ht-muted">{detail(item)}</div>
                  {reason && <div className="mt-1 text-yellow-300">⚠ {reason}</div>}
                  {editable && !reason && (
                    <div className="mt-2 text-right">
                      <button type="button" className="ht-step" onClick={() => onSelect(item)}>
                        {selectLabel ? selectLabel(item) : selected ? '✕ remove' : '✓ select'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div className="p-2 text-ht-muted">No matches.</div>}
      </div>
    </div>
  );
}
