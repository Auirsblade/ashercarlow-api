// apps/swdnd/src/panels/PlayerHome/index.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  createCharacter, deleteCharacter, getCharacter, getPlayerByToken, loadReference,
  type CharacterDto, type PlayerDto,
} from '../../lib/characters';
import { classSummary } from '../../lib/sheetView';
import { computeSheet } from '../../lib/rules';
import { stepStatus, STEP_ORDER } from '../../lib/validation';
import type { ReferenceData } from '../../lib/rules/types';

interface RowData {
  dto: CharacterDto;
  classLine: string;
  stepsDone: number;
  stepsTotal: number;
}

function toRow(dto: CharacterDto, ref: ReferenceData): RowData {
  const derived = computeSheet(dto.data_json, ref);
  const status = stepStatus(dto.data_json, ref, derived);
  const applicable = STEP_ORDER.filter((k) => status[k].applicable);
  return {
    dto,
    classLine: classSummary(dto.data_json, ref) || 'no class yet',
    stepsDone: applicable.filter((k) => status[k].state === 'done').length,
    stepsTotal: applicable.length,
  };
}

export default function PlayerHome() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const [player, setPlayer] = useState<PlayerDto | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([getPlayerByToken(token), loadReference()])
      .then(async ([me, ref]) => {
        setPlayer(me.player);
        const dtos = await Promise.all(me.characters.map((c) => getCharacter(c.id)));
        setRows(dtos.map((d) => toRow(d, ref)));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [token]);

  const create = async () => {
    if (!player || !newName.trim()) return;
    const c = await createCharacter(player.campaign_id, newName.trim(), token);
    navigate(`/sheet/${c.id}/build?token=${encodeURIComponent(token)}`);
  };
  const remove = async (id: string) => {
    await deleteCharacter(id, token);
    setConfirmDelete(null);
    reload();
  };

  if (!token) return <div className="p-6 font-mono text-red-400">Missing player token.</div>;
  if (loading) return <div className="p-6 font-mono text-ht-muted">Loading…</div>;
  if (error || !player) return <div className="p-6 font-mono text-red-400">{error ?? 'Unknown player'}</div>;

  return (
    <div className="ht-screen min-h-screen p-4 font-mono text-ht-text">
      <div className="ht-glow mb-3 rounded-md p-3">
        <div className="ht-name text-sm font-bold">{player.name}</div>
        <div className="text-[10px] text-ht-muted">your characters</div>
      </div>

      <div className="flex flex-col gap-2">
        {rows.length === 0 && <div className="text-[11px] text-ht-muted">No characters yet — create your first below.</div>}
        {rows.map(({ dto, classLine, stepsDone, stepsTotal }) => (
          <div key={dto.id} className="ht-panel flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-[140px]">
              <div className="text-ht-bright">{dto.name}</div>
              <div className="text-[10px] text-ht-muted">{classLine}</div>
            </div>
            <div className="text-[10px] text-ht-muted">
              {stepsDone === stepsTotal ? '✓ build complete' : `${stepsDone}/${stepsTotal} steps`}
            </div>
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              <a className="ht-step" href={`/sheet/${dto.id}?token=${encodeURIComponent(token)}`}>sheet</a>
              <a className="ht-step" href={`/sheet/${dto.id}/build?token=${encodeURIComponent(token)}`}>build</a>
              {confirmDelete === dto.id ? (
                <span>
                  <button type="button" className="ht-step text-red-400" onClick={() => void remove(dto.id)}>confirm ✕</button>
                  <button type="button" className="ht-step" onClick={() => setConfirmDelete(null)}>keep</button>
                </span>
              ) : (
                <button type="button" className="text-[10px] text-ht-muted" onClick={() => setConfirmDelete(dto.id)}>delete</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="ht-panel mt-3 flex items-center gap-2 p-3">
        <span className="ht-label">New character</span>
        <input
          className="w-48 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
        />
        <button type="button" className="ht-step" onClick={() => void create()}>+ create &amp; build</button>
      </div>
    </div>
  );
}
