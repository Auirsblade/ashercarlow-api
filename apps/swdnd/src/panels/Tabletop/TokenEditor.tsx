// apps/swdnd/src/panels/Tabletop/TokenEditor.tsx
import { useState } from 'react';
import type { TokenDto } from '../../lib/scenes';
import { conditionColor } from '../../lib/rings';

export default function TokenEditor({
  token, onEdit, onDelete, onClose,
}: {
  token: TokenDto;
  onEdit: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [newCondition, setNewCondition] = useState('');
  const [confirming, setConfirming] = useState(false);
  const isCharacter = !!token.character_id;

  const addCondition = () => {
    const c = newCondition.trim();
    if (!c || token.conditions_json.includes(c)) return;
    onEdit(token.id, { conditions: [...token.conditions_json, c] });
    setNewCondition('');
  };

  return (
    <div className="ht-panel flex flex-wrap items-center gap-3 p-2 text-[11px]">
      <span className="ht-label">{token.name}</span>

      {isCharacter ? (
        <span className="text-[10px] text-ht-muted">hp &amp; conditions come from the character sheet</span>
      ) : (
        <>
          <label className="flex items-center gap-1">
            hp
            <input
              className="w-12 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
              type="number" value={token.hp ?? ''}
              onChange={(e) => onEdit(token.id, { hp: e.target.value === '' ? null : Number(e.target.value) })}
            />
            /
            <input
              className="w-12 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
              type="number" value={token.max_hp ?? ''}
              onChange={(e) => onEdit(token.id, { max_hp: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
          <span className="flex items-center gap-1">
            {token.conditions_json.map((c) => (
              <button
                key={c} type="button" className="ht-step"
                style={{ color: conditionColor(c) }}
                title="remove"
                onClick={() => onEdit(token.id, { conditions: token.conditions_json.filter((x) => x !== c) })}
              >
                {c} ✕
              </button>
            ))}
            <input
              className="w-24 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
              placeholder="+ condition…" value={newCondition}
              onChange={(e) => setNewCondition(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCondition()}
            />
          </span>
        </>
      )}

      <label className="flex items-center gap-1">
        faction
        <select
          className="border-b border-ht-line bg-transparent text-ht-bright outline-none"
          value={token.faction}
          onChange={(e) => onEdit(token.id, { faction: e.target.value })}
        >
          <option value="friendly">friendly</option>
          <option value="hostile">hostile</option>
          <option value="neutral">neutral</option>
        </select>
      </label>

      <label className="flex items-center gap-1">
        size
        <select
          className="border-b border-ht-line bg-transparent text-ht-bright outline-none"
          value={token.scale}
          onChange={(e) => onEdit(token.id, { scale: Number(e.target.value) })}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
      </label>

      <button
        type="button"
        className={`ht-step ${token.hidden ? 'ht-tile-active' : ''}`}
        onClick={() => onEdit(token.id, { hidden: token.hidden ? 0 : 1 })}
      >
        {token.hidden ? '◌ hidden' : '● visible'}
      </button>

      <span className="ml-auto flex items-center gap-2">
        {confirming ? (
          <>
            <button type="button" className="ht-step text-red-400" onClick={() => { onDelete(token.id); onClose(); }}>confirm ✕</button>
            <button type="button" className="ht-step" onClick={() => setConfirming(false)}>keep</button>
          </>
        ) : (
          <button type="button" className="text-[10px] text-ht-muted" onClick={() => setConfirming(true)}>delete</button>
        )}
        <button type="button" className="ht-step" onClick={onClose}>✕ close</button>
      </span>
    </div>
  );
}
