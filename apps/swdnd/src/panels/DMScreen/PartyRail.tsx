// apps/swdnd/src/panels/DMScreen/PartyRail.tsx — read-only live party cards.
import { Link } from 'react-router-dom';
import { conditionColor, hpColor, hpFraction } from '../../lib/rings';
import type { PartyCard } from '../../lib/partyCards';

function Card({ card }: { card: PartyCard }) {
  const frac = hpFraction(card.hp, card.maxHp) ?? 0;
  return (
    <div className="ht-panel min-w-[220px] shrink-0 p-3 @[860px]:min-w-0 @[860px]:shrink">
      <div className="flex items-baseline justify-between gap-2">
        <Link to={`/sheet/${card.id}`} className="ht-name text-[13px] font-bold text-ht-bright">
          {card.name}
        </Link>
        {card.inspiration && <span title="inspiration" className="text-[11px] text-ht-bright">★</span>}
      </div>
      <div className="text-[10px] text-ht-muted">{card.classLine}</div>

      <div className="mt-2 h-1.5 overflow-hidden rounded bg-ht-line/40">
        <div
          className="h-full"
          style={{ width: `${Math.round(frac * 100)}%`, background: hpColor(frac) }}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="text-ht-bright">
          {card.hp}/{card.maxHp}{card.tempHp > 0 ? ` (+${card.tempHp})` : ''} HP
        </span>
        <span className="text-ht-muted">AC {card.ac}</span>
        <span className="text-ht-muted">SPD {card.speed}</span>
        <span className="text-ht-muted">PP {card.passivePerception}</span>
        {card.exhaustion > 0 && <span className="text-red-400">EXH {card.exhaustion}</span>}
      </div>

      {card.conditions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {card.conditions.map((cond) => (
            <span
              key={cond}
              className="rounded border border-ht-line px-1 text-[9px]"
              style={{ color: conditionColor(cond) }}
            >
              {cond}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PartyRail({ cards }: { cards: PartyCard[] }) {
  if (cards.length === 0) {
    return <div className="ht-panel p-3 text-[11px] text-ht-muted">No characters yet.</div>;
  }
  return (
    <div className="flex gap-2 overflow-x-auto @[860px]:flex-col @[860px]:overflow-x-visible">
      {cards.map((c) => <Card key={c.id} card={c} />)}
    </div>
  );
}
