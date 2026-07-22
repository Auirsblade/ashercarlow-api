// apps/swdnd/src/lib/sheetView.ts
import type { CharacterBuild, CastType, ReferenceData, RefPower } from './rules/types';

export const remaining = (max: number, spent: number): number => Math.max(0, max - spent);
export const powerCost = (level: number): number => (level === 0 ? 0 : level + 1);

/** "Consular 5 / Fighter 1" — class names + levels in first-taken order; falls back to raw ids. */
export function classSummary(build: CharacterBuild, ref: ReferenceData): string {
  const counts = new Map<string, number>();
  for (const l of build.levels) counts.set(l.classId, (counts.get(l.classId) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, n]) => `${ref.classes[id]?.name ?? id} ${n}`)
    .join(' / ');
}

export interface PowerGroup {
  level: number;
  label: string;
  cost: number;
  powers: RefPower[];
}

function groupTrack(powers: RefPower[]): PowerGroup[] {
  const byLevel = new Map<number, RefPower[]>();
  for (const p of powers) {
    const list = byLevel.get(p.level) ?? [];
    list.push(p);
    byLevel.set(p.level, list);
  }
  return [...byLevel.keys()]
    .sort((a, b) => a - b)
    .map((level) => ({
      level,
      label: level === 0 ? 'At-will' : `Level ${level}`,
      cost: powerCost(level),
      powers: byLevel.get(level)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function knownPowersByLevel(
  build: CharacterBuild,
  ref: ReferenceData,
): Record<CastType, PowerGroup[]> {
  const resolved = build.knownPowers
    .map((id) => ref.powers[id])
    .filter((p): p is RefPower => Boolean(p));
  return {
    force: groupTrack(resolved.filter((p) => p.castType === 'force')),
    tech: groupTrack(resolved.filter((p) => p.castType === 'tech')),
  };
}
