// apps/swdnd/src/panels/ShipSheet/Sheet/CrewStrip.tsx
import { useEffect, useState } from 'react';
import { PanelLink } from '../../../components/split';
import { type CharacterDto, listCharacters } from '../../../lib/characters';
import { deleteShipCrew, putShipCrew, type ShipCrewMember } from '../../../lib/starships';
import type { ShipRole } from '../../../lib/shipRules/types';

// Mirrors the backend's SHIP_ROLES (apps/backend/src/routes/swdnd/starships.ts) —
// duplicated rather than shared across the frontend/backend boundary, matching
// this repo's existing convention (e.g. shipConditionOptions / condition lists).
const SHIP_ROLES: ShipRole[] = ['coordinator', 'gunner', 'mechanic', 'operator', 'pilot', 'technician'];

interface Props {
  shipId: string;
  campaignId: string | null;
  crew: ShipCrewMember[];
  canEdit: boolean;
  token: string | null;
  onReload: () => void;
}

export default function CrewStrip({ shipId, campaignId, crew, canEdit, token, onReload }: Props) {
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [pickCharacterId, setPickCharacterId] = useState('');
  const [pickRole, setPickRole] = useState<ShipRole>(SHIP_ROLES[0]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit || !campaignId) return;
    let alive = true;
    listCharacters(campaignId)
      .then((cs) => alive && setCharacters(cs))
      .catch(() => alive && setCharacters([]));
    return () => { alive = false; };
  }, [campaignId, canEdit]);

  const onAssign = () => {
    if (!pickCharacterId) return;
    setBusy(true);
    setLocalError(null);
    putShipCrew(shipId, { characterId: pickCharacterId, role: pickRole }, token)
      .then(() => { setPickCharacterId(''); onReload(); })
      .catch((e: unknown) => setLocalError(e instanceof Error ? e.message : 'Failed to assign crew'))
      .finally(() => setBusy(false));
  };

  const onRemove = (characterId: string, role: ShipRole) => {
    setBusy(true);
    setLocalError(null);
    deleteShipCrew(shipId, { characterId, role }, token)
      .then(() => onReload())
      .catch((e: unknown) => setLocalError(e instanceof Error ? e.message : 'Failed to remove crew'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="ht-panel p-2 font-mono text-[11px]">
      <div className="ht-label mb-1">Crew</div>
      {crew.length === 0 && (
        <div className="text-ht-muted">
          {canEdit
            ? 'Nobody aboard — assign a character below.'
            : 'Nobody aboard — the DM or any crew member can assign characters here.'}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {crew.map((m) => (
          <span key={`${m.character_id}:${m.role}`} className="flex items-center gap-1">
            <PanelLink
              to={{ kind: 'sheet', id: m.character_id }}
              current={{ kind: 'ship', id: shipId }}
              className="ht-step"
              title="open this character's sheet (alt-click: beside the ship)"
            >
              {m.character_name} <span className="text-ht-muted">· {m.role}</span>
            </PanelLink>
            {canEdit && (
              <button
                type="button"
                className="text-red-400"
                disabled={busy}
                title="Remove from crew"
                onClick={() => onRemove(m.character_id, m.role)}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>

      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <select
            className="max-w-[160px] border-b border-ht-line bg-transparent text-ht-text outline-none"
            title="character to assign"
            value={pickCharacterId}
            onChange={(e) => setPickCharacterId(e.target.value)}
          >
            <option value="">choose character…</option>
            {characters.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
          </select>
          <select
            className="border-b border-ht-line bg-transparent text-ht-text outline-none"
            title="role to assign"
            value={pickRole}
            onChange={(e) => setPickRole(e.target.value as ShipRole)}
          >
            {SHIP_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button type="button" className="ht-step" disabled={busy || !pickCharacterId} onClick={onAssign}>
            + assign
          </button>
        </div>
      )}

      {localError && <div className="mt-1 text-red-300">⚠ {localError}</div>}
    </div>
  );
}
