// apps/swdnd/src/panels/Tabletop/TokenEditor.tsx
import { useEffect, useState } from 'react';
import type { TokenDto } from '../../lib/scenes';
import { conditionColor } from '../../lib/rings';
import TokenImageControls from './TokenImageControls';

const hpDraftValue = (v: number | null): string => (v == null ? '' : String(v));

export default function TokenEditor({
  token, onEdit, onDelete, onImageUpload, onImageClear, onClose,
}: {
  token: TokenDto;
  onEdit: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onImageUpload: (id: string, file: File) => void;
  onImageClear: (id: string) => void;
  onClose: () => void;
}) {
  const [newCondition, setNewCondition] = useState('');
  const [confirming, setConfirming] = useState(false);
  const isCharacter = !!token.character_id;

  // hp/max_hp are buffered locally and only PATCHed on blur/Enter — committing
  // per keystroke lets a stale token:updated echo land mid-typing and clobber
  // digits under latency. Reset the buffer only when the selected token
  // changes (this component stays mounted across selection changes), not on
  // every echoed prop update.
  const [hpDraft, setHpDraft] = useState(() => hpDraftValue(token.hp));
  const [maxHpDraft, setMaxHpDraft] = useState(() => hpDraftValue(token.max_hp));
  useEffect(() => {
    setHpDraft(hpDraftValue(token.hp));
    setMaxHpDraft(hpDraftValue(token.max_hp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.id]);

  const commitHp = () => {
    if (hpDraft === '') { onEdit(token.id, { hp: null }); return; }
    const n = Number(hpDraft);
    if (Number.isNaN(n)) return;
    onEdit(token.id, { hp: n });
  };
  const commitMaxHp = () => {
    if (maxHpDraft === '') { onEdit(token.id, { max_hp: null }); return; }
    const n = Number(maxHpDraft);
    if (Number.isNaN(n)) return;
    onEdit(token.id, { max_hp: n });
  };

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
              type="number" value={hpDraft}
              onChange={(e) => setHpDraft(e.target.value)}
              onBlur={commitHp}
              onKeyDown={(e) => e.key === 'Enter' && commitHp()}
            />
            /
            <input
              className="w-12 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
              type="number" value={maxHpDraft}
              onChange={(e) => setMaxHpDraft(e.target.value)}
              onBlur={commitMaxHp}
              onKeyDown={(e) => e.key === 'Enter' && commitMaxHp()}
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

      <TokenImageControls
        token={token}
        onUpload={(f) => onImageUpload(token.id, f)}
        onClear={() => onImageClear(token.id)}
      />

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
