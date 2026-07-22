// apps/swdnd/src/lib/playState.ts
import type { CharacterBuild, DerivedSheet, PlayState, RefPower } from './rules/types';

export type PlayAction =
  | { t: 'damage'; n: number }
  | { t: 'heal'; n: number }
  | { t: 'setHp'; n: number }
  | { t: 'setTemp'; n: number }
  | { t: 'spendForce'; n: number }
  | { t: 'spendTech'; n: number }
  | { t: 'castPower'; power: RefPower }
  | { t: 'restForce' }
  | { t: 'restTech' }
  | { t: 'spendHitDie' }
  | { t: 'regainHitDie' }
  | { t: 'spendSuperiority' }
  | { t: 'regainSuperiority' }
  | { t: 'addCondition'; c: string }
  | { t: 'removeCondition'; c: string }
  | { t: 'setExhaustion'; n: number }
  | { t: 'toggleInspiration' };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function applyPlayAction(
  build: CharacterBuild,
  derived: DerivedSheet,
  action: PlayAction,
): PlayState {
  const p: PlayState = { ...build.play, conditions: [...build.play.conditions] };
  const supMax = derived.superiority?.diceMax ?? 0;

  switch (action.t) {
    case 'damage': {
      let n = Math.max(0, action.n);
      const absorbed = Math.min(p.tempHp, n);
      p.tempHp -= absorbed;
      n -= absorbed;
      p.hp = clamp(p.hp - n, 0, derived.maxHp);
      break;
    }
    case 'heal':
      p.hp = clamp(p.hp + Math.max(0, action.n), 0, derived.maxHp);
      break;
    case 'setHp':
      // Exact-entry: set HP directly (does not route through temp HP).
      p.hp = clamp(action.n, 0, derived.maxHp);
      break;
    case 'setTemp':
      p.tempHp = Math.max(0, action.n);
      break;
    case 'spendForce':
      p.forcePointsSpent = clamp(p.forcePointsSpent + action.n, 0, derived.casting.force.pointsMax);
      break;
    case 'spendTech':
      p.techPointsSpent = clamp(p.techPointsSpent + action.n, 0, derived.casting.tech.pointsMax);
      break;
    case 'castPower': {
      const cost = action.power.level === 0 ? 0 : action.power.level + 1;
      if (action.power.castType === 'force') {
        p.forcePointsSpent = clamp(p.forcePointsSpent + cost, 0, derived.casting.force.pointsMax);
      } else {
        p.techPointsSpent = clamp(p.techPointsSpent + cost, 0, derived.casting.tech.pointsMax);
      }
      break;
    }
    case 'restForce':
      p.forcePointsSpent = 0;
      break;
    case 'restTech':
      p.techPointsSpent = 0;
      break;
    case 'spendHitDie':
      p.hitDiceSpent = clamp(p.hitDiceSpent + 1, 0, derived.totalLevel);
      break;
    case 'regainHitDie':
      p.hitDiceSpent = clamp(p.hitDiceSpent - 1, 0, derived.totalLevel);
      break;
    case 'spendSuperiority':
      p.superiorityDiceSpent = clamp(p.superiorityDiceSpent + 1, 0, supMax);
      break;
    case 'regainSuperiority':
      p.superiorityDiceSpent = clamp(p.superiorityDiceSpent - 1, 0, supMax);
      break;
    case 'addCondition':
      if (!p.conditions.includes(action.c)) p.conditions.push(action.c);
      break;
    case 'removeCondition':
      p.conditions = p.conditions.filter((c) => c !== action.c);
      break;
    case 'setExhaustion':
      p.exhaustion = clamp(action.n, 0, 6);
      break;
    case 'toggleInspiration':
      p.inspiration = !p.inspiration;
      break;
  }
  return p;
}
