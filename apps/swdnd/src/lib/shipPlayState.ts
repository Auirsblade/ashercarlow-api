// apps/swdnd/src/lib/shipPlayState.ts
import { LEVELED_SHIP_CONDITIONS, MAX_SYSTEM_DAMAGE } from './shipRules/constants';
import type { DerivedShip, ShipBuild, ShipPlayState } from './shipRules/types';

export type ShipPlayAction =
  | { t: 'damage'; n: number }
  | { t: 'repairHull'; n: number }
  | { t: 'restoreShields'; n: number }
  | { t: 'setHull'; n: number }
  | { t: 'setShields'; n: number }
  | { t: 'spendHullDie' }
  | { t: 'regainHullDie' }
  | { t: 'spendShieldDie' }
  | { t: 'regainShieldDie' }
  | { t: 'spendAmmo'; entryId: string; n: number }
  | { t: 'reloadAmmo'; entryId: string }
  | { t: 'addCondition'; c: string }
  | { t: 'removeCondition'; c: string }
  | { t: 'setSystemDamage'; n: number }
  | { t: 'setNotes'; notes: string };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 'Slowed 3' -> 'Slowed'; a plain condition returns itself. */
function conditionFamily(c: string): string {
  const family = c.replace(/\s+\d+$/, '');
  return LEVELED_SHIP_CONDITIONS.includes(family) ? family : c;
}

export function applyShipPlayAction(
  build: ShipBuild,
  derived: DerivedShip,
  action: ShipPlayAction,
): ShipPlayState {
  const p: ShipPlayState = {
    ...build.play,
    conditions: [...build.play.conditions],
    ammoSpent: { ...build.play.ammoSpent },
  };

  switch (action.t) {
    case 'damage': {
      // SOTG: shields absorb first, the remainder carries into the hull.
      let n = Math.max(0, action.n);
      const absorbed = Math.min(p.shields, n);
      p.shields -= absorbed;
      n -= absorbed;
      p.hull = clamp(p.hull - n, 0, derived.maxHull);
      break;
    }
    case 'repairHull':
      p.hull = clamp(p.hull + Math.max(0, action.n), 0, derived.maxHull);
      break;
    case 'restoreShields':
      p.shields = clamp(p.shields + Math.max(0, action.n), 0, derived.maxShields);
      break;
    case 'setHull':
      p.hull = clamp(action.n, 0, derived.maxHull);
      break;
    case 'setShields':
      p.shields = clamp(action.n, 0, derived.maxShields);
      break;
    case 'spendHullDie':
      p.hullDiceSpent = clamp(p.hullDiceSpent + 1, 0, derived.hullDice.count);
      break;
    case 'regainHullDie':
      p.hullDiceSpent = clamp(p.hullDiceSpent - 1, 0, derived.hullDice.count);
      break;
    case 'spendShieldDie':
      p.shieldDiceSpent = clamp(p.shieldDiceSpent + 1, 0, derived.shieldDice.count);
      break;
    case 'regainShieldDie':
      p.shieldDiceSpent = clamp(p.shieldDiceSpent - 1, 0, derived.shieldDice.count);
      break;
    case 'spendAmmo':
      p.ammoSpent[action.entryId] = Math.max(0, (p.ammoSpent[action.entryId] ?? 0) + action.n);
      break;
    case 'reloadAmmo':
      delete p.ammoSpent[action.entryId];
      break;
    case 'addCondition': {
      // A levelled condition ('Slowed 1'…'Slowed 4') replaces its own family.
      const family = conditionFamily(action.c);
      p.conditions = p.conditions.filter((c) => conditionFamily(c) !== family);
      p.conditions.push(action.c);
      break;
    }
    case 'removeCondition':
      p.conditions = p.conditions.filter((c) => c !== action.c);
      break;
    case 'setSystemDamage':
      // Numeric 0-6 in its own field, never a condition string.
      p.systemDamage = clamp(Math.round(action.n), 0, MAX_SYSTEM_DAMAGE);
      break;
    case 'setNotes':
      p.notes = action.notes;
      break;
  }
  return p;
}
