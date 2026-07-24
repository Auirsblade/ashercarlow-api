// apps/swdnd/src/panels/DMScreen/EncounterList.tsx — named monster groups.
import { useState } from 'react';
import {
  addMonster, removeMonster, setCount, totalCount,
  type EncounterDto, type EncounterMonster,
} from '../../lib/encounters';
import type { MonsterView } from '../../lib/monsters';
import BufferedText from './BufferedText';

interface Props {
  encounters: EncounterDto[];
  monsters: MonsterView[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onSetMonsters: (id: string, monsters: EncounterMonster[]) => void;
  onSpawnAll: (enc: EncounterDto) => void;
  onDelete: (id: string) => void;
}

export default function EncounterList({ encounters, monsters, onCreate, onRename, onSetMonsters, onSpawnAll, onDelete }: Props) {
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [addPick, setAddPick] = useState<Record<string, string>>({});
  const nameOf = (id: string) => monsters.find((m) => m.id === id)?.name ?? `(unknown ${id})`;

  const create = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim());
    setNewName('');
  };

  return (
    <div className="flex flex-col gap-2">
      {encounters.length === 0 && (
        <div className="text-[11px] text-ht-muted">No encounters yet — create a named group below, then add monsters from the browser or here.</div>
      )}
      {encounters.map((enc) => (
        <div key={enc.id} className="ht-panel p-3">
          <div className="flex flex-wrap items-center gap-2">
            <BufferedText
              value={enc.name}
              onCommit={(name) => onRename(enc.id, name)}
              className="min-w-[140px] border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
            />
            <span className="text-[10px] text-ht-muted">{totalCount(enc.monsters_json)} monsters</span>
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              <button type="button" className="ht-step" onClick={() => onSpawnAll(enc)}>spawn all</button>
              {confirmDelete === enc.id ? (
                <span className="flex items-center gap-1 text-[10px]">
                  <button type="button" className="ht-step text-red-400" onClick={() => { setConfirmDelete(null); onDelete(enc.id); }}>confirm ✕</button>
                  <button type="button" className="ht-step" onClick={() => setConfirmDelete(null)}>keep</button>
                </span>
              ) : (
                <button type="button" className="text-[10px] text-ht-muted" onClick={() => setConfirmDelete(enc.id)}>delete</button>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {enc.monsters_json.map((m) => (
              <span key={m.monsterId} className="flex items-center gap-1 rounded border border-ht-line px-1 py-0.5 text-[10px]">
                <span className="text-ht-bright">{nameOf(m.monsterId)}</span>
                <button type="button" className="text-ht-muted" onClick={() => onSetMonsters(enc.id, setCount(enc.monsters_json, m.monsterId, m.count - 1))}>−</button>
                <span>×{m.count}</span>
                <button type="button" className="text-ht-muted" onClick={() => onSetMonsters(enc.id, setCount(enc.monsters_json, m.monsterId, m.count + 1))}>+</button>
                <button type="button" className="text-red-400" onClick={() => onSetMonsters(enc.id, removeMonster(enc.monsters_json, m.monsterId))}>✕</button>
              </span>
            ))}
            <span className="flex items-center gap-1 text-[10px]">
              <select
                className="max-w-[160px] border-b border-ht-line bg-transparent text-ht-text outline-none"
                value={addPick[enc.id] ?? ''}
                onChange={(e) => setAddPick((cur) => ({ ...cur, [enc.id]: e.target.value }))}
              >
                <option value="">add monster…</option>
                {monsters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button
                type="button"
                className="ht-step"
                onClick={() => {
                  const pick = addPick[enc.id];
                  if (pick) onSetMonsters(enc.id, addMonster(enc.monsters_json, pick));
                }}
              >
                +
              </button>
            </span>
          </div>
        </div>
      ))}

      <div className="ht-panel flex flex-wrap items-center gap-2 p-3">
        <span className="ht-label">New encounter</span>
        <input
          className="w-48 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button type="button" className="ht-step" onClick={create}>+ create</button>
      </div>
    </div>
  );
}
