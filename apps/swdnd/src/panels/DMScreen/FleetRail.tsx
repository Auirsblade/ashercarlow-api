// apps/swdnd/src/panels/DMScreen/FleetRail.tsx — read-only live campaign-ship
// cards (shields over hull, as on the ship sheet). Ship names open the ShipSheet
// panel; alt-click splits, courtesy of PanelLink.
import { PanelLink } from '../../components/split';
import { conditionColor, hpColor, hpFraction } from '../../lib/rings';
import type { ShipCard } from '../../lib/shipCards';

function Card({ card, campaignId }: { card: ShipCard; campaignId: string }) {
  const hullFrac = hpFraction(card.hull, card.maxHull) ?? 0;
  const shieldFrac = hpFraction(card.shields, card.maxShields) ?? 0;
  return (
    <div className="ht-panel min-w-[220px] shrink-0 p-3 @[860px]:min-w-0 @[860px]:shrink">
      <div className="flex items-baseline justify-between gap-2">
        <PanelLink
          to={{ kind: 'ship', id: card.id }}
          current={{ kind: 'dm', id: campaignId }}
          className="ht-name text-[13px] font-bold text-ht-bright"
        >
          {card.name}
        </PanelLink>
        <span className="text-[10px] text-ht-muted">T{card.tier}</span>
      </div>
      <div className="text-[10px] text-ht-muted">{card.sizeName || 'unsized'}</div>

      <div className="mt-2 h-1.5 overflow-hidden rounded bg-ht-line/40">
        <div className="h-full" style={{ width: `${Math.round(shieldFrac * 100)}%`, background: '#89ddff' }} />
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-ht-line/40">
        <div className="h-full" style={{ width: `${Math.round(hullFrac * 100)}%`, background: hpColor(hullFrac) }} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="text-ht-bright">{card.shields}/{card.maxShields} SHD</span>
        <span className="text-ht-bright">{card.hull}/{card.maxHull} HULL</span>
        {card.systemDamage > 0 && <span className="text-red-400">SYS {card.systemDamage}</span>}
      </div>

      {card.conditions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {card.conditions.map((cond) => (
            <span key={cond} className="rounded border border-ht-line px-1 text-[9px]" style={{ color: conditionColor(cond) }}>
              {cond}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FleetRail({ cards, campaignId }: { cards: ShipCard[]; campaignId: string }) {
  if (cards.length === 0) {
    return <div className="ht-panel p-3 text-[11px] text-ht-muted">No ships yet — add one from the ships tab.</div>;
  }
  return (
    <div className="flex gap-2 overflow-x-auto @[860px]:flex-col @[860px]:overflow-x-visible">
      {cards.map((c) => <Card key={c.id} card={c} campaignId={campaignId} />)}
    </div>
  );
}
