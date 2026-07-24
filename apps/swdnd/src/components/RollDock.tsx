// apps/swdnd/src/components/RollDock.tsx — floating roll log + dice roller.
// Mounted on the map, the character sheet page, and the DM screen.
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useRollLog } from '../hooks/useRollLog';
import { parseFormula } from '../lib/dice';
import { addDie, addModifier, type RollDto } from '../lib/rolls';
import { useSplit } from './split';

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;

function RollLine({ r }: { r: RollDto }) {
  return (
    <div className="border-b border-ht-line/40 py-1">
      <div className="flex items-baseline gap-2">
        <span className="ht-label shrink-0">{r.hidden ? '🔒 ' : ''}{r.roller}</span>
        {r.label && <span className="truncate text-[10px] text-ht-muted">{r.label}</span>}
        <b className="ml-auto text-base text-ht-bright">{r.total}</b>
      </div>
      <div className="text-[10px] text-ht-muted">
        {r.formula} · [{r.rolls_json.map((d) => d.value).join(', ')}]
      </div>
    </div>
  );
}

function RollDockInner({ campaignId }: { campaignId: string }) {
  const { authed } = useAuth();
  const log = useRollLog(campaignId);
  const [open, setOpen] = useState(false);
  const [formula, setFormula] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState(false);
  const [advMode, setAdvMode] = useState<'norm' | 'adv' | 'dis'>('norm');

  const terms = parseFormula(formula);
  const canAdv = !!terms && terms.dice.length === 1
    && terms.dice[0].count === 1 && terms.dice[0].sides === 20;
  const latest = log.rolls.find((r) => !r.hidden) ?? log.rolls[0] ?? null;

  const doRoll = () => {
    if (!terms) return;
    void log.roll(formula, {
      label: label.trim() || undefined,
      hidden: authed && secret,
      advantage: canAdv && advMode === 'adv',
      disadvantage: canAdv && advMode === 'dis',
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ht-glow fixed bottom-4 left-4 z-30 rounded-md px-3 py-2 font-mono text-[11px] text-ht-text"
        onClick={() => setOpen(true)}
      >
        🎲{latest ? <> {latest.roller} · {latest.formula} = <b className="text-ht-bright">{latest.total}</b></> : ' rolls'}
      </button>
    );
  }

  return (
    <div className="ht-panel fixed bottom-4 left-4 z-30 flex w-80 max-w-[92vw] flex-col rounded-md p-2 font-mono text-[11px] text-ht-text">
      <div className="flex items-center gap-2">
        <span className="ht-label">roll log</span>
        <button type="button" className="ht-step ml-auto" onClick={() => setOpen(false)}>✕</button>
      </div>

      <div className="my-1 max-h-56 overflow-y-auto">
        {log.rolls.length === 0 && <div className="py-2 text-ht-muted">No rolls yet.</div>}
        {log.rolls.map((r) => <RollLine key={r.id} r={r} />)}
      </div>

      {log.error && <div className="mb-1 text-[10px] text-red-400">⚠ {log.error}</div>}

      <div className="flex flex-wrap items-center gap-1">
        {DICE.map((d) => (
          <button key={d} type="button" className="ht-step" onClick={() => setFormula((f) => addDie(f, d))}>
            d{d}
          </button>
        ))}
        <button type="button" className="ht-step" onClick={() => setFormula((f) => addModifier(f, 1))}>+1</button>
        <button type="button" className="ht-step" onClick={() => setFormula((f) => addModifier(f, -1))}>−1</button>
        <button type="button" className="ht-step" onClick={() => setFormula('')}>clear</button>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <input
          className="w-24 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="2d6+3" value={formula}
          onChange={(e) => setFormula(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doRoll()}
        />
        <input
          className="min-w-0 flex-1 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="label…" value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doRoll()}
        />
      </div>

      <div className="mt-1 flex items-center gap-2">
        {canAdv && (
          <>
            <button type="button" className={`ht-step ${advMode === 'adv' ? 'ht-tile-active' : ''}`}
              onClick={() => setAdvMode((m) => (m === 'adv' ? 'norm' : 'adv'))}>adv</button>
            <button type="button" className={`ht-step ${advMode === 'dis' ? 'ht-tile-active' : ''}`}
              onClick={() => setAdvMode((m) => (m === 'dis' ? 'norm' : 'dis'))}>dis</button>
          </>
        )}
        {authed && (
          <label className="flex items-center gap-1 text-[10px] text-ht-muted">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
            secret
          </label>
        )}
        <button type="button" className="ht-step ht-tile-active ml-auto" disabled={!terms} onClick={doRoll}>
          roll
        </button>
      </div>
    </div>
  );
}

export default function RollDock({ campaignId }: { campaignId: string }) {
  // Inside a split panel, the SplitPage mounts the one true dock — a
  // panel-embedded dock would double the pill and the websocket.
  if (useSplit()) return null;
  return <RollDockInner campaignId={campaignId} />;
}
