// apps/swdnd/src/lib/rules/constants.ts
import type { AbilityKey, CastType, Progression, SkillKey } from './types';

export const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const SKILLS: Record<SkillKey, { ability: AbilityKey; label: string }> = {
  acr: { ability: 'dex', label: 'Acrobatics' },
  ani: { ability: 'wis', label: 'Animal Handling' },
  ath: { ability: 'str', label: 'Athletics' },
  dec: { ability: 'cha', label: 'Deception' },
  ins: { ability: 'wis', label: 'Insight' },
  itm: { ability: 'cha', label: 'Intimidation' },
  inv: { ability: 'int', label: 'Investigation' },
  lor: { ability: 'int', label: 'Lore' },
  med: { ability: 'wis', label: 'Medicine' },
  nat: { ability: 'int', label: 'Nature' },
  prc: { ability: 'wis', label: 'Perception' },
  prf: { ability: 'cha', label: 'Performance' },
  per: { ability: 'cha', label: 'Persuasion' },
  pil: { ability: 'int', label: 'Piloting' },
  slt: { ability: 'dex', label: 'Sleight of Hand' },
  ste: { ability: 'dex', label: 'Stealth' },
  sur: { ability: 'wis', label: 'Survival' },
  tec: { ability: 'int', label: 'Technology' },
};

type CastProg = Exclude<Progression, 'none'>;

export const POWER_POINTS_BASE: Record<CastProg, number> = {
  full: 4, '3/4': 3, half: 2, arch: 1,
};

export const POWER_MAX_LEVEL: Record<CastProg, number[]> = {
  full: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 9],
  '3/4': [0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 7],
  half: [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5],
  arch: [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4],
};

export const POWER_LIMIT: Record<CastProg, number> = {
  full: 6, '3/4': 5, half: 4, arch: 4,
};

export const POWERS_KNOWN: Record<CastType, Record<CastProg, number[]>> = {
  force: {
    full: [0, 9, 11, 13, 15, 17, 19, 21, 23, 25, 26, 28, 29, 31, 32, 34, 35, 37, 38, 39, 40],
    '3/4': [0, 7, 9, 11, 13, 15, 17, 18, 19, 21, 22, 24, 25, 26, 28, 29, 30, 32, 33, 34, 35],
    half: [0, 5, 7, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25, 27, 28, 29, 30],
    arch: [0, 0, 0, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25],
  },
  tech: {
    full: [0, 6, 7, 9, 10, 12, 13, 15, 16, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    '3/4': [0, 0, 0, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
    half: [0, 0, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    arch: [0, 0, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  },
};

export const POWER_POINTS_BONUS: Record<CastType, AbilityKey[]> = {
  force: ['wis', 'cha'],
  tech: ['int'],
};

/** A class's contribution-per-level to its track's caster level. */
export function casterWeight(prog: CastProg): number {
  return POWER_MAX_LEVEL[prog][20] / 9;
}

export const SUPERIORITY_DICE_QUANT = [
  0, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
];
export const SUPERIORITY_DIE_SIZE = [
  '', 'd4', 'd4', 'd4', 'd4', 'd6', 'd6', 'd6', 'd6', 'd8', 'd8', 'd8', 'd8',
  'd10', 'd10', 'd10', 'd10', 'd12', 'd12', 'd12', 'd12',
];
export const MANEUVERS_KNOWN = [
  0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24,
];
