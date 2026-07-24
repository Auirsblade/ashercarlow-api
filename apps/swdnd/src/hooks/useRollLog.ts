// apps/swdnd/src/hooks/useRollLog.ts — self-contained roll-log state for RollDock.
// Own WS connection on purpose: the dock mounts on three different surfaces
// (map, sheet, DM screen) without coupling to their hooks.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { connectCampaign, type WsEnvelope } from '../lib/ws';
import { parseFormula, rollD20, rollFormula } from '../lib/dice';
import { appendRoll, listRolls, postRoll, type RollDto } from '../lib/rolls';

export interface RollOpts {
  label?: string;
  hidden?: boolean;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface RollLogState {
  rolls: RollDto[];
  error: string | null;
  roll: (formula: string, opts?: RollOpts) => Promise<void>;
}

export function useRollLog(campaignId: string): RollLogState {
  const [searchParams] = useSearchParams();
  const playerToken = searchParams.get('token');
  const [rolls, setRolls] = useState<RollDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const pending = useRef<RollDto[]>([]);

  const reload = useCallback(() => {
    loaded.current = false;
    pending.current = [];
    listRolls(campaignId)
      .then((list) => {
        loaded.current = true;
        let next = list;
        for (const r of pending.current) next = appendRoll(next, r);
        pending.current = [];
        setRolls(next);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load rolls'));
  }, [campaignId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    const hadOpened = { current: false };
    const sock = connectCampaign(campaignId, (env: WsEnvelope) => {
      if (env.type !== 'roll:created') return;
      const r = env.payload as RollDto;
      if (!loaded.current) {
        pending.current.push(r);
        return;
      }
      setRolls((cur) => appendRoll(cur, r));
    }, (open) => {
      if (open) {
        if (hadOpened.current) reload();
        hadOpened.current = true;
      }
    }, playerToken);
    return () => sock.close();
  }, [campaignId, playerToken, reload]);

  const roll = useCallback(async (formula: string, opts: RollOpts = {}) => {
    const terms = parseFormula(formula);
    if (!terms) {
      setError(`Can't parse "${formula}" — try 2d6+3`);
      return;
    }
    try {
      let posted: RollDto;
      if (opts.advantage || opts.disadvantage) {
        // adv/dis is offered only for a single d20 (+ modifier)
        const r = rollD20(terms.modifier, { advantage: opts.advantage, disadvantage: opts.disadvantage });
        const suffix = opts.advantage ? '(adv)' : '(dis)';
        posted = await postRoll(campaignId, {
          label: opts.label ? `${opts.label} ${suffix}` : suffix,
          formula,
          rolls: r.rolls.map((v) => ({ sides: 20, value: v })),
          total: r.total,
          hidden: opts.hidden,
        }, playerToken);
      } else {
        const r = rollFormula(terms);
        posted = await postRoll(campaignId, {
          label: opts.label,
          formula: r.formula,
          rolls: r.rolls,
          total: r.total,
          hidden: opts.hidden,
        }, playerToken);
      }
      // The POST response covers hidden rolls (no WS echo); appendRoll dedupes the echo for public ones.
      setRolls((cur) => appendRoll(cur, posted));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Roll failed');
    }
  }, [campaignId, playerToken]);

  return { rolls, error, roll };
}
