// apps/swdnd/src/lib/vitals.ts — live hp/conditions for character-linked tokens.
import type { TokenDto } from './scenes';
import type { CharacterDto } from './characters';
import type { ReferenceData } from './rules/types';
import { computeSheet } from './rules';

export interface Vitals { hp: number; maxHp: number; conditions: string[] }
export interface TokenVitals { hp: number | null; maxHp: number | null; conditions: string[] }

/** Initial snapshot: computeSheet gives maxHp; play gives current hp + conditions. */
export function buildVitals(characters: CharacterDto[], ref: ReferenceData): Record<string, Vitals> {
  const out: Record<string, Vitals> = {};
  for (const c of characters) {
    const derived = computeSheet(c.data_json, ref);
    out[c.id] = {
      hp: c.data_json.play.hp,
      maxHp: derived.maxHp,
      conditions: [...c.data_json.play.conditions],
    };
  }
  return out;
}

/**
 * Merge a `character:updated` play payload. maxHp stays as computed at load —
 * a mid-session level-up won't refresh it until reload (acceptable v1; the
 * play.hp delta rule shifts current hp on level changes anyway).
 */
export function mergePlay(
  vitals: Record<string, Vitals>,
  characterId: string,
  play: { hp: number; conditions: string[] },
): Record<string, Vitals> {
  const cur = vitals[characterId];
  if (!cur) return vitals;
  return { ...vitals, [characterId]: { ...cur, hp: play.hp, conditions: [...play.conditions] } };
}

/** Which hp/conditions a token displays: sheet-derived for character tokens, own columns for NPCs. */
export function tokenVitals(token: TokenDto, vitals: Record<string, Vitals>): TokenVitals {
  if (token.character_id) {
    const v = vitals[token.character_id];
    return v ? { hp: v.hp, maxHp: v.maxHp, conditions: v.conditions } : { hp: null, maxHp: null, conditions: [] };
  }
  return { hp: token.hp, maxHp: token.max_hp, conditions: token.conditions_json };
}
