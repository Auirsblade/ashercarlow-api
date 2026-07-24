// apps/swdnd/src/lib/dice.ts
export type Rng = () => number; // returns [0, 1)
export const defaultRng: Rng = () => Math.random();

export function rollDie(sides: number, rng: Rng = defaultRng): number {
  return Math.floor(rng() * sides) + 1;
}

export interface D20Result {
  total: number;
  rolls: number[];
  kept: number;
  mod: number;
}

export function rollD20(
  mod: number,
  opts: { advantage?: boolean; disadvantage?: boolean } = {},
  rng: Rng = defaultRng,
): D20Result {
  const a = rollDie(20, rng);
  if (!opts.advantage && !opts.disadvantage) {
    return { total: a + mod, rolls: [a], kept: a, mod };
  }
  const b = rollDie(20, rng);
  const kept = opts.advantage ? Math.max(a, b) : Math.min(a, b);
  return { total: kept + mod, rolls: [a, b], kept, mod };
}

export interface DamageResult {
  total: number;
  rolls: number[];
  formula: string;
}

/** Parse and roll a simple `NdM(+/-K)?` formula. Unparseable → total 0. */
export function rollDamage(formula: string, rng: Rng = defaultRng): DamageResult {
  const m = /^\s*(\d+)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(formula);
  if (!m) return { total: 0, rolls: [], formula };
  const count = Number(m[1]);
  const sides = Number(m[2]);
  const bonus = m[3] ? Number(m[3].replace(/\s+/g, '')) : 0;
  const rolls = Array.from({ length: count }, () => rollDie(sides, rng));
  return { total: rolls.reduce((s, r) => s + r, 0) + bonus, rolls, formula };
}

export interface DiceTerm { count: number; sides: number }
export interface FormulaTerms { dice: DiceTerm[]; modifier: number }

/**
 * Parse a sum of dice terms and integer constants: `2d6+1d8+3-1`.
 * Bare `dNN` counts as one die. Whitespace/case tolerant. Requires at least
 * one die; negative dice terms and silly ranges are rejected. → null on junk.
 */
export function parseFormula(input: string): FormulaTerms | null {
  const s = input.replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  const token = /([+-]?)(?:(\d*)d(\d+)|(\d+))/g;
  const dice: DiceTerm[] = [];
  let modifier = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = token.exec(s))) {
    if (m.index !== idx) return null;            // gap between tokens → junk
    if (idx > 0 && m[1] === '') return null;     // later terms need an explicit sign
    const negative = m[1] === '-';
    if (m[3] !== undefined) {
      if (negative) return null;                 // no negative dice
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = Number(m[3]);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
      dice.push({ count, sides });
    } else {
      modifier += negative ? -Number(m[4]) : Number(m[4]);
    }
    idx = token.lastIndex;
  }
  if (idx !== s.length || dice.length === 0) return null;
  return { dice, modifier };
}

/** Canonical string form: dice joined with '+', signed trailing modifier, 0 omitted. */
export function formatFormula(t: FormulaTerms): string {
  const dice = t.dice.map((d) => `${d.count}d${d.sides}`).join('+');
  if (t.modifier === 0) return dice;
  return `${dice}${t.modifier > 0 ? '+' : ''}${t.modifier}`;
}

export interface FormulaResult { total: number; rolls: { sides: number; value: number }[]; formula: string }

export function rollFormula(terms: FormulaTerms, rng: Rng = defaultRng): FormulaResult {
  const rolls = terms.dice.flatMap((t) =>
    Array.from({ length: t.count }, () => ({ sides: t.sides, value: rollDie(t.sides, rng) })));
  return {
    total: rolls.reduce((s, r) => s + r.value, 0) + terms.modifier,
    rolls,
    formula: formatFormula(terms),
  };
}
