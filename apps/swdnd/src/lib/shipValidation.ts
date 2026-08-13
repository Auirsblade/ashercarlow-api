// apps/swdnd/src/lib/shipValidation.ts
// Ship validation is BUDGET-based, not sequential: steps report capacity
// ("2/4 hardpoints", "suite 1/2") and go to `attention` only when a budget is
// exceeded. Over-budget is a warning, never a block — the ⌂ house-rule unlock
// silences it, exactly like character validation.
import { installedShield } from './shipRules/defense';
import type { DerivedShip, ShipBuild, ShipReferenceData } from './shipRules/types';
import type { StepInfo, StepState } from './validation';

export type ShipStepKey = 'size' | 'tier' | 'hull' | 'weapons' | 'equipment' | 'modifications';
export const SHIP_STEP_ORDER: ShipStepKey[] = [
  'size', 'tier', 'hull', 'weapons', 'equipment', 'modifications',
];

const info = (state: StepState, summary: string, applicable = true): StepInfo => ({ state, summary, applicable });

/** SOTG grants two ability points per tier. */
const TIER_POINT_BUDGET = 2;

export function shipStepStatus(
  build: ShipBuild,
  ref: ShipReferenceData,
  derived: DerivedShip,
): Record<ShipStepKey, StepInfo> {
  const houseRuled = new Set(build.houseRuled ?? []);
  const overBudget = (step: ShipStepKey, used: number, max: number): StepState =>
    used > max && !houseRuled.has(step) ? 'attention' : 'done';

  const size = ref.sizes[build.identity.sizeId];
  const sizeInfo = size ? info('done', size.name) : info('untouched', '—');

  // Tier: done once every granted ability point is spent.
  const tier = derived.tier;
  const pointBudget = tier * TIER_POINT_BUDGET;
  const spent = build.abilities.increases.reduce((s, i) => s + i.amount, 0);
  const tierInfo = tier === 0
    ? info('untouched', '—')
    : spent < pointBudget
      ? info('attention', `tier ${tier} · ${pointBudget - spent} pt${pointBudget - spent === 1 ? '' : 's'} left`)
      : info('done', `tier ${tier}`);

  // Hull & shields: a ship with no generator has no shields at all.
  const shield = installedShield(build, ref);
  const hullInfo = !size
    ? info('untouched', '—')
    : !shield
      ? info('attention', `hull ${derived.maxHull} · no shield generator`)
      : info('done', `hull ${derived.maxHull} · shields ${derived.maxShields}`);

  const weaponsInfo = derived.hardpointsUsed === 0
    ? info('untouched', size ? `0/${derived.hardpointsMax} hardpoints` : '—')
    : info(
        overBudget('weapons', derived.hardpointsUsed, derived.hardpointsMax),
        `${derived.hardpointsUsed}/${derived.hardpointsMax} hardpoints`,
      );

  // Equipment: reactor / hyperdrive / coupling — hull/shields are hullInfo's job, not this one's.
  const equipmentOf = (kind: 'reactor' | 'hyperdrive' | 'coupling') => {
    const entry = build.equipment.find((e) => e.kind === kind);
    return entry ? ref.equipment[entry.ref]?.name : undefined;
  };
  const parts = [equipmentOf('reactor'), equipmentOf('hyperdrive'), equipmentOf('coupling')].filter(Boolean) as string[];
  const equipmentInfo = parts.length === 0 ? info('untouched', '—') : info('done', parts.join(' · '));

  const modSummary =
    `${derived.modSlotsUsed}/${derived.modSlotsMax} slots · suite ${derived.suitesUsed}/${derived.suitesMax}`;
  const modState: StepState =
    build.modifications.length === 0
      ? 'untouched'
      : overBudget('modifications', derived.modSlotsUsed, derived.modSlotsMax) === 'attention'
        || overBudget('modifications', derived.suitesUsed, derived.suitesMax) === 'attention'
        ? 'attention'
        : 'done';
  const modificationsInfo = info(modState, build.modifications.length === 0 && !size ? '—' : modSummary);

  return {
    size: sizeInfo,
    tier: tierInfo,
    hull: hullInfo,
    weapons: weaponsInfo,
    equipment: equipmentInfo,
    modifications: modificationsInfo,
  };
}
