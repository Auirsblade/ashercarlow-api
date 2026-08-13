// apps/swdnd/src/panels/ShipSheet/Sheet/CrewStrip.tsx
import { PanelLink } from '../../../components/split';
import type { ShipCrewMember } from '../../../lib/starships';

export default function CrewStrip({ shipId, crew }: { shipId: string; crew: ShipCrewMember[] }) {
  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Crew</div>
      {crew.length === 0 && (
        <div className="text-ht-muted">
          Nobody aboard — assign a character in the refit screen. Only crew (and the DM) may edit this ship.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {crew.map((m) => (
          <PanelLink
            key={`${m.character_id}:${m.role}`}
            to={{ kind: 'sheet', id: m.character_id }}
            current={{ kind: 'ship', id: shipId }}
            className="ht-step"
            title="open this character's sheet (alt-click: beside the ship)"
          >
            {m.character_name} <span className="text-ht-muted">· {m.role}</span>
          </PanelLink>
        ))}
      </div>
    </div>
  );
}
