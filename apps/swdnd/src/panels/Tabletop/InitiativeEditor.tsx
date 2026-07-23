// apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx
import { useEffect, useState } from 'react';
import type { TokenDto } from '../../lib/scenes';
import {
  entriesFromTokens, removeEntry, sortByRoll, startInitiative, type Initiative,
} from '../../lib/initiative';

export default function InitiativeEditor({
  initiative, tokens, onChange, onClose,
}: {
  initiative: Initiative | null;
  tokens: TokenDto[];
  onChange: (init: Initiative | null) => void;
  onClose: () => void;
}) {
  // Buffered roll drafts keyed by tokenId; reseed when the entry set changes.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const entryKey = (initiative?.order ?? []).map((e) => e.tokenId).join(',');
  useEffect(() => {
    setDrafts(Object.fromEntries((initiative?.order ?? []).map((e) => [e.tokenId, String(e.roll)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey]);

  const commitRoll = (tokenId: string) => {
    if (!initiative) return;
    const n = Number(drafts[tokenId]);
    if (Number.isNaN(n)) return;
    onChange({
      ...initiative,
      order: initiative.order.map((e) => (e.tokenId === tokenId ? { ...e, roll: n } : e)),
    });
  };

  return (
    <div className="ht-panel flex flex-wrap items-center gap-3 p-2 text-[11px]">
      <span className="ht-label">Initiative</span>
      {!initiative && (
        <button
          type="button" className="ht-step"
          onClick={() => onChange(startInitiative(entriesFromTokens(tokens)))}
        >
          ⚔ start from tokens
        </button>
      )}
      {initiative && (
        <>
          {initiative.order.map((e) => (
            <span key={e.tokenId} className="flex items-center gap-1">
              <span className="text-ht-bright">{e.name}</span>
              <input
                className="w-10 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
                type="number"
                value={drafts[e.tokenId] ?? String(e.roll)}
                onChange={(ev) => setDrafts((d) => ({ ...d, [e.tokenId]: ev.target.value }))}
                onBlur={() => commitRoll(e.tokenId)}
                onKeyDown={(ev) => ev.key === 'Enter' && commitRoll(e.tokenId)}
              />
              <button
                type="button" className="text-[10px] text-ht-muted"
                onClick={() => onChange(removeEntry(initiative, e.tokenId))}
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button" className="ht-step"
            onClick={() => onChange({ ...initiative, order: sortByRoll(initiative.order), activeIndex: 0 })}
          >
            ⇅ sort
          </button>
          <button type="button" className="ht-step text-red-400" onClick={() => onChange(null)}>end encounter</button>
        </>
      )}
      <button type="button" className="ml-auto ht-step" onClick={onClose}>✕ close</button>
    </div>
  );
}
