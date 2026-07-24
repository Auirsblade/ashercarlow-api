// apps/swdnd/src/components/RollableText.tsx — rich-text renderer whose dice
// references (see lib/diceText) are clickable and post to the campaign roll
// log. RollTriggerProvider wraps any surface that mounts a RollDock; without
// a provider the text renders plain.
import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { parseFormula, rollFormula } from '../lib/dice';
import { postRoll } from '../lib/rolls';
import { segmentDiceText } from '../lib/diceText';

interface RollTrigger { roll: (formula: string, label?: string) => Promise<number | null> }

const RollTriggerContext = createContext<RollTrigger | null>(null);

export function RollTriggerProvider({ campaignId, children }: { campaignId: string; children: ReactNode }) {
  const { authed } = useAuth();
  const [searchParams] = useSearchParams();
  const playerToken = searchParams.get('token');

  const roll = useCallback(async (formula: string, label?: string) => {
    const terms = parseFormula(formula);
    if (!terms) return null;
    const r = rollFormula(terms);
    // DM text-rolls are secret (no WS broadcast — the inline result below is
    // what the DM sees); players' land in the shared log via the echo. A
    // failed POST still shows the local result inline.
    await postRoll(
      campaignId,
      { label, formula: r.formula, rolls: r.rolls, total: r.total, hidden: authed },
      playerToken,
    ).catch(() => {});
    return r.total;
  }, [campaignId, authed, playerToken]);

  const value = useMemo(() => ({ roll }), [roll]);
  return <RollTriggerContext.Provider value={value}>{children}</RollTriggerContext.Provider>;
}

export default function RollableText({ text, className }: { text: string; className?: string }) {
  const trigger = useContext(RollTriggerContext);
  const [results, setResults] = useState<Record<number, number>>({});
  const segs = useMemo(() => segmentDiceText(text), [text]);

  if (!trigger || !segs.some((s) => s.kind === 'roll')) {
    return <span className={className}>{text}</span>;
  }
  return (
    <span className={className}>
      {segs.map((s, i) =>
        s.kind === 'text' ? (
          s.text
        ) : (
          <span key={i}>
            <button
              type="button"
              className="cursor-pointer text-ht-accent underline decoration-dotted underline-offset-2 hover:text-ht-bright"
              title={`roll ${s.formula}${s.label ? ` — ${s.label}` : ''}`}
              onClick={() =>
                void trigger.roll(s.formula, s.label).then((total) => {
                  if (total != null) setResults((r) => ({ ...r, [i]: total }));
                })}
            >
              {s.text}
            </button>
            {results[i] != null && <b className="text-ht-bright"> = {results[i]}</b>}
          </span>
        ),
      )}
    </span>
  );
}
