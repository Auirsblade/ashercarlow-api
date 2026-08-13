// apps/swdnd/src/lib/crew.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type CharacterBuild, type PlayState } from './rules/types';
import {
  crewInputFrom, crewProficiency, currentTechDie, deploymentRankForRole, techDieForRank, TECH_DIE_LADDER,
} from './crew';
import type { RefDeployment } from './shipRules/types';

const deployments: Record<string, RefDeployment> = {
  gun: { id: 'gun', name: 'Gunner', role: 'gunner', description: '' },
  pil: { id: 'pil', name: 'Pilot', role: 'pilot', description: '' },
  mec: { id: 'mec', name: 'Mechanic', role: 'mechanic', description: '' },
  odd: { id: 'odd', name: 'Quartermaster', role: null, description: '' },
};

function character(levels: number, entries: Array<{ deploymentId: string; rank: number }>): CharacterBuild {
  const b = emptyBuild('crew');
  b.levels = Array.from({ length: levels }, (_, i) => ({
    n: i + 1, classId: 'fighter', archetypeId: null, hp: 'avg' as const, choices: {},
  }));
  b.deployments = entries;
  return b;
}

test('deploymentRankForRole matches through the deployment reference, best rank wins', () => {
  const b = character(5, [{ deploymentId: 'gun', rank: 2 }, { deploymentId: 'pil', rank: 4 }]);
  expect(deploymentRankForRole(b, 'gunner', deployments)).toBe(2);
  expect(deploymentRankForRole(b, 'pilot', deployments)).toBe(4);
  expect(deploymentRankForRole(b, 'mechanic', deployments)).toBe(0);
  // Unknown ids and role-less rows contribute nothing.
  expect(deploymentRankForRole(character(1, [{ deploymentId: 'odd', rank: 5 }]), 'gunner', deployments)).toBe(0);
  expect(deploymentRankForRole(character(1, [{ deploymentId: 'ghost', rank: 5 }]), 'gunner', deployments)).toBe(0);
  // Pre-v2 documents have no deployments at all.
  expect(deploymentRankForRole(emptyBuild('old'), 'gunner', deployments)).toBe(0);
});

test('crewProficiency reads the character total level, no reference data needed', () => {
  expect(crewProficiency(character(1, []))).toBe(2);
  expect(crewProficiency(character(5, []))).toBe(3);
  expect(crewProficiency(character(17, []))).toBe(6);
});

test('crewInputFrom only counts crew deployed at rank 1+ in the role they crew', () => {
  const gunner = character(5, [{ deploymentId: 'gun', rank: 1 }]);      // prof +3
  const pilotNotDeployed = character(9, []);                            // prof +4, no deployment
  const wrongRole = character(17, [{ deploymentId: 'pil', rank: 5 }]);  // prof +6, but crews as mechanic

  const input = crewInputFrom([
    { role: 'gunner', build: gunner },
    { role: 'pilot', build: pilotNotDeployed },
    { role: 'mechanic', build: wrongRole },
  ], deployments);

  expect(input.proficiencyByRole).toEqual({ gunner: 3 });
});

test('crewInputFrom keeps the best proficiency when a role is double-crewed', () => {
  const rookie = character(1, [{ deploymentId: 'gun', rank: 1 }]);  // prof +2
  const veteran = character(13, [{ deploymentId: 'gun', rank: 3 }]); // prof +5
  const input = crewInputFrom([
    { role: 'gunner', build: veteran },
    { role: 'gunner', build: rookie },
  ], deployments);
  expect(input.proficiencyByRole).toEqual({ gunner: 5 });
  expect(crewInputFrom([], deployments).proficiencyByRole).toEqual({});
});

test('techDieForRank walks the SotG ladder', () => {
  expect(TECH_DIE_LADDER).toEqual([0, 4, 6, 8, 10, 12]);
  expect([0, 1, 2, 3, 4, 5].map(techDieForRank)).toEqual([0, 4, 6, 8, 10, 12]);
  expect(techDieForRank(9)).toBe(12);
  expect(techDieForRank(-1)).toBe(0);
});

test('currentTechDie prefers the stored size and reports whether it is overridden', () => {
  const mech = character(5, [{ deploymentId: 'mec', rank: 3 }]);
  const play = (techDie?: number): PlayState => ({ ...emptyBuild('x').play, techDie });

  expect(currentTechDie(mech, play(), deployments)).toEqual({ base: 8, current: 8, overridden: false });
  expect(currentTechDie(mech, play(6), deployments)).toEqual({ base: 8, current: 6, overridden: true });
  // 0 is the RAW "unusable" state, not "unset".
  expect(currentTechDie(mech, play(0), deployments)).toEqual({ base: 8, current: 0, overridden: true });
  // No Mechanic deployment → no tech die at all.
  expect(currentTechDie(emptyBuild('x'), play(), deployments)).toEqual({ base: 0, current: 0, overridden: false });
});
