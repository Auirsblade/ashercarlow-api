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
