// apps/swdnd/src/lib/faction.ts
import type { CSSProperties } from 'react';
import type { Alignment } from './rules/types';

export const FACTION_ACCENT: Record<Alignment, string> = {
  light: '#7aa2ff',
  dark: '#ff5470',
  universal: '#4dd0e1',
  none: '#4dd0e1',
};

export function factionAccent(alignment: Alignment): string {
  return FACTION_ACCENT[alignment] ?? '#4dd0e1';
}

/** Inline style that sets --faction so descendant utilities can reference it. */
export function factionStyle(alignment: Alignment): CSSProperties {
  return { ['--faction']: factionAccent(alignment) } as CSSProperties;
}
