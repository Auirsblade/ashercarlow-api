// apps/swdnd/src/lib/crew.ts
// The single bridge between the character engine and the ship engine: crew
// rows + character builds in, CrewInput out. Pure and synchronous.
import { deploymentsOf, proficiencyBonus, totalLevel } from './rules/core';
import type { CharacterBuild, PlayState } from './rules/types';
import type { CrewInput, RefDeployment, ShipRole } from './shipRules/types';

export interface CrewMemberInput {
  /** The role this character is crewing on the ship (from `starship_crew`). */
  role: ShipRole;
  build: CharacterBuild;
}

/**
 * A crew member's proficiency bonus, straight off their build document.
 *
 * Deliberately NOT `computeSheet(...).proficiencyBonus`: proficiency is the only
 * number CrewInput consumes, and reaching it through a full DerivedSheet would
 * make every ship-sheet mount pay the ten-request character reference loader
 * (design decision 7). If a later feature needs more of the crew's derived
 * sheet, add the reference load then and widen CrewMemberInput.
 */
export function crewProficiency(build: CharacterBuild): number {
  return proficiencyBonus(totalLevel(build));
}

/** Best rank the character holds in the deployment matching `role` (0 = none). */
export function deploymentRankForRole(
  build: CharacterBuild,
  role: ShipRole,
  deployments: Record<string, RefDeployment>,
): number {
  let best = 0;
  for (const entry of deploymentsOf(build)) {
    if (deployments[entry.deploymentId]?.role !== role) continue;
    if (entry.rank > best) best = entry.rank;
  }
  return best;
}

/**
 * SotG: a crew member contributes their proficiency bonus only in a role they
 * are deployed to at rank 1 or higher. Several crew in one role (multiple
 * gunners are legal) resolve to the best bonus.
 */
export function crewInputFrom(
  members: CrewMemberInput[],
  deployments: Record<string, RefDeployment>,
): CrewInput {
  const proficiencyByRole: Partial<Record<ShipRole, number>> = {};
  for (const m of members) {
    if (deploymentRankForRole(m.build, m.role, deployments) < 1) continue;
    const prof = crewProficiency(m.build);
    const current = proficiencyByRole[m.role];
    if (current === undefined || prof > current) proficiencyByRole[m.role] = prof;
  }
  return { proficiencyByRole };
}

/** Tech-die sizes by Mechanic rank: index 0 (no rank) = unusable. */
export const TECH_DIE_LADDER: readonly number[] = [0, 4, 6, 8, 10, 12];

export function techDieForRank(rank: number): number {
  const r = Math.max(0, Math.min(5, Math.trunc(rank)));
  return TECH_DIE_LADDER[r];
}

/**
 * The tech die to render. `play.techDie` is the player's manual override — the
 * temporary shrink/grow from rolling a 1 or the maximum, which we never
 * automate. Absent means "sitting at the rank-derived base".
 */
export function currentTechDie(
  build: CharacterBuild,
  play: PlayState,
  deployments: Record<string, RefDeployment>,
): { base: number; current: number; overridden: boolean } {
  const base = techDieForRank(deploymentRankForRole(build, 'mechanic', deployments));
  const overridden = typeof play.techDie === 'number';
  return { base, current: overridden ? play.techDie! : base, overridden };
}
