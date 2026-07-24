// apps/swdnd/src/lib/rolls.ts — roll-log REST client + pure log/builder helpers.
import { api } from './api';
import { formatFormula, parseFormula } from './dice';

export interface RollDie { sides: number; value: number }
export interface RollDto {
  id: string; campaign_id: string; roller: string; label: string | null;
  formula: string; rolls_json: RollDie[]; total: number; hidden: number; created_at: string;
}
export interface PostRollBody {
  roller?: string; label?: string; formula: string; rolls: RollDie[]; total: number; hidden?: boolean;
}

const auth = (token?: string | null): Record<string, string> => (token ? { 'X-Player-Token': token } : {});

export const listRolls = (campaignId: string, limit = 50) =>
  api<RollDto[]>(`/swdnd/campaigns/${campaignId}/rolls?limit=${limit}`);
export const postRoll = (campaignId: string, body: PostRollBody, token?: string | null) =>
  api<RollDto>(`/swdnd/campaigns/${campaignId}/rolls`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

export const MAX_LOG = 100;

/** Prepend a roll (log is newest-first); dedupe by id (POST response vs WS echo); cap in-memory size. */
export function appendRoll(list: RollDto[], roll: RollDto): RollDto[] {
  if (list.some((r) => r.id === roll.id)) return list;
  return [roll, ...list].slice(0, MAX_LOG);
}

/** Quick-button: add one die, collapsing into an existing same-sided term. Junk restarts the formula. */
export function addDie(formula: string, sides: number): string {
  const terms = parseFormula(formula) ?? { dice: [], modifier: 0 };
  const existing = terms.dice.find((d) => d.sides === sides);
  if (existing) existing.count += 1;
  else terms.dice.push({ count: 1, sides });
  return formatFormula(terms);
}

/** Merge a constant into the formula's modifier. Inert until the formula has a die. */
export function addModifier(formula: string, delta: number): string {
  const terms = parseFormula(formula);
  if (!terms) return formula;
  terms.modifier += delta;
  return formatFormula(terms);
}
