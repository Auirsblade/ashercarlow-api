// apps/swdnd/src/panels/Tabletop/InitiativeEditor.tsx
import { useEffect, useState } from 'react';
import type { TokenDto } from '../../lib/scenes';
import {
  entriesFromTokens, groupCrew, removeEntry, sortByRoll, startInitiative, ungroupCrew, type Initiative,
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
          {initiative.order.map((e) => {
            const tok = tokens.find((x) => x.id === e.tokenId);
            const ships = initiative.order.filter((s) => s.tokenId !== e.tokenId
              && tokens.find((x) => x.id === s.tokenId)?.ship_id);
            const nameFor = (id: string) => tokens.find((x) => x.id === id)?.name ?? id;
            // A crewed entry carries its crew nested inside it — removing it outright
            // would delete that nested crew array wholesale and silently drop those
            // creatures from the tracker. This can't be gated on the token existing:
            // nothing prunes initiative_json when a token is deleted, so a destroyed
            // ship's entry (and its nested crew) survives with tok undefined. Gate on
            // the entry's own crew field instead — only ship entries ever acquire crew,
            // so a crewed entry always needs ungrouping first, token or no token.
            const crewed = !!e.crew?.length;
            const removeThis = () => onChange(removeEntry(
              crewed ? ungroupCrew(initiative, e.tokenId, nameFor) : initiative,
              e.tokenId,
            ));
            return (
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
                {crewed ? (
                  <button
                    type="button" className="ht-step text-[10px]"
                    title="split the crew back out into their own turns — they return at the ship's roll"
                    onClick={() => onChange(ungroupCrew(initiative, e.tokenId, nameFor))}
                  >
                    ⇱ {e.crew?.length ?? 0} crew
                  </button>
                ) : null}
                {tok && !tok.ship_id && !crewed && ships.length > 0 && (
                  <select
                    className="border-b border-ht-line bg-transparent text-[10px] text-ht-muted outline-none"
                    title="fold this creature into a ship's turn — the lowest crew roll sets the ship's place"
                    value=""
                    onChange={(ev) => ev.target.value && onChange(groupCrew(initiative, ev.target.value, [e.tokenId]))}
                  >
                    <option value="">crew of…</option>
                    {ships.map((s) => <option key={s.tokenId} value={s.tokenId}>{s.name}</option>)}
                  </select>
                )}
                <button
                  type="button" className="text-[10px] text-ht-muted"
                  title={crewed ? 'ungroup the crew, then remove this ship' : 'remove from initiative'}
                  onClick={removeThis}
                >
                  ✕
                </button>
              </span>
            );
          })}
          <button
            type="button" className="ht-step"
            title="re-apply roll order — needed after grouping crew, since folding a crew's roll into its ship changes the ship's roll but not its place in this list"
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
