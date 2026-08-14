// apps/swdnd/src/lib/shipPlay.ts — pure edits to a ship's play document.
// PATCH /swdnd/starships/{id} is a whole-document write, so map-side condition
// and system-damage edits produce a new ShipBuild rather than a field patch.
import { LEVELED_SHIP_CONDITIONS } from './shipRules/constants';
import { MAX_SYSTEM_DAMAGE } from './shipTokens';

/** The slice of ShipBuild these edits touch; extra keys pass through untouched. */
export interface ShipDocLike {
  play: { conditions?: string[]; systemDamage?: number; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * 'Slowed 3' -> 'Slowed'; a plain condition returns itself.
 *
 * PARITY REQUIREMENT: this must behave exactly like the module-private
 * conditionFamily() in lib/shipPlayState.ts (the ShipSheet's write path). The
 * spine does not export its copy, so the rule is duplicated here — but the
 * DATA it reads (LEVELED_SHIP_CONDITIONS) is shared, and both paths edit the
 * same ShipPlayState.conditions array. If the spine ever exports its helper,
 * delete this one and import it instead.
 */
function conditionFamily(c: string): string {
  const family = c.replace(/\s+\d+$/, '');
  return LEVELED_SHIP_CONDITIONS.includes(family) ? family : c;
}

/**
 * Add or remove one space condition ('Ionized', 'Slowed 3', … — SHIP_CONDITIONS).
 * A levelled condition replaces its own family, so 'Slowed 3' picked while
 * 'Slowed 1' is set leaves only 'Slowed 3'; picking the active value clears it.
 * Same eviction rule as the sheet's addCondition/removeCondition pair.
 */
export function toggleShipCondition<T extends ShipDocLike>(doc: T, name: string): T {
  const cur = Array.isArray(doc.play?.conditions) ? doc.play.conditions : [];
  const family = conditionFamily(name);
  const next = cur.includes(name)
    ? cur.filter((c) => c !== name)
    : [...cur.filter((c) => conditionFamily(c) !== family), name];
  return { ...doc, play: { ...doc.play, conditions: next } } as T;
}

/** Set the 0-6 system-damage counter (clamped and rounded). */
export function setSystemDamage<T extends ShipDocLike>(doc: T, value: number): T {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  const clamped = Math.min(MAX_SYSTEM_DAMAGE, Math.max(0, n));
  return { ...doc, play: { ...doc.play, systemDamage: clamped } } as T;
}
