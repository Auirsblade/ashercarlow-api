// apps/swdnd/src/lib/shipRules/power.test.ts
import { test, expect } from 'bun:test';
import {
  couplingKindOf, derivePower, emptyPowerDice, powerCapacity, powerDiceOf, powerDieForTier,
  reactorKindOf, reactorRecovery,
} from './power';
import type { ShipBuild, ShipPlayState, ShipReferenceData } from './types';
import { emptyShipBuild } from './types';

test('power die size follows ship tier; tier 0 is a flat 1', () => {
  expect(powerDieForTier(0)).toEqual({ sides: null, label: '1' });
  expect(powerDieForTier(1)).toEqual({ sides: 4, label: 'd4' });
  expect(powerDieForTier(2)).toEqual({ sides: 6, label: 'd6' });
  expect(powerDieForTier(3)).toEqual({ sides: 8, label: 'd8' });
  expect(powerDieForTier(4)).toEqual({ sides: 10, label: 'd10' });
  expect(powerDieForTier(5)).toEqual({ sides: 12, label: 'd12' });
  expect(powerDieForTier(11)).toEqual({ sides: 12, label: 'd12' }); // clamped
});

test('coupling and reactor kinds are recognised from the pack row names', () => {
  expect(couplingKindOf('Direct Power Coupling')).toBe('direct');
  expect(couplingKindOf('Distributed Power Coupling')).toBe('distributed');
  expect(couplingKindOf('Hub & Spoke Power Coupling')).toBe('hub-spoke');
  expect(couplingKindOf('Power Core Reactor')).toBeNull();
  expect(reactorKindOf('Fuel Cell Reactor')).toBe('fuel-cell');
  expect(reactorKindOf('Ionization Reactor')).toBe('ionization');
  expect(reactorKindOf('Power Core Reactor')).toBe('power-core');
  expect(reactorKindOf('Hyperdrive, Class 1.0')).toBeNull();
});

test('capacity is set by the coupling topology', () => {
  expect(powerCapacity('direct')).toEqual({ central: 4, perSystem: 0 });
  expect(powerCapacity('distributed')).toEqual({ central: 0, perSystem: 2 });
  expect(powerCapacity('hub-spoke')).toEqual({ central: 2, perSystem: 1 });
  expect(powerCapacity(null)).toEqual({ central: 0, perSystem: 0 });
});

test('reactor recovery rates are displayed, never applied', () => {
  expect(reactorRecovery('fuel-cell')).toEqual({ kind: 'fuel-cell', formula: '1', label: '1 die' });
  expect(reactorRecovery('ionization')).toEqual({ kind: 'ionization', formula: '1d2-1', label: '1d2−1 dice' });
  expect(reactorRecovery('power-core')).toEqual({ kind: 'power-core', formula: '1d2', label: '1d2 dice' });
  expect(reactorRecovery(null)).toEqual({ kind: null, formula: '0', label: 'no reactor' });
});

test('powerDiceOf tolerates pre-v2 ship documents', () => {
  const legacy = { ...emptyShipBuild('Old').play } as ShipPlayState;
  delete (legacy as { powerDice?: unknown }).powerDice;
  expect(powerDiceOf(legacy)).toEqual(emptyPowerDice());
  const filled: ShipPlayState = {
    ...legacy,
    powerDice: { central: 2, systems: { comms: 0, engines: 1, shields: 1, sensors: 0, weapons: 1 } },
  };
  expect(powerDiceOf(filled).central).toBe(2);
  expect(powerDiceOf(filled).systems.engines).toBe(1);
});

test('derivePower reads tier, coupling and reactor off the build', () => {
  // ShipReferenceData.equipment holds reactors, couplings and hyperdrives
  // (ShipReferenceData.armor holds armor AND shields — not read here).
  const ref = {
    equipment: {
      hub: { id: 'hub', name: 'Hub & Spoke Power Coupling', kind: 'coupling' },
      core: { id: 'core', name: 'Power Core Reactor', kind: 'reactor' },
      hyper: { id: 'hyper', name: 'Hyperdrive, Class 2', kind: 'hyperdrive' },
    },
  } as unknown as ShipReferenceData;
  const build = {
    ...emptyShipBuild('Krayt'),
    identity: { ...emptyShipBuild('Krayt').identity, tier: 3 },
    equipment: [
      { id: 'e1', ref: 'hyper', kind: 'hyperdrive' },
      { id: 'e2', ref: 'hub', kind: 'coupling' },
      { id: 'e3', ref: 'core', kind: 'reactor' },
    ],
  } as unknown as ShipBuild;

  const power = derivePower(build, ref);
  expect(power.die).toEqual({ sides: 8, label: 'd8' });
  expect(power.coupling).toBe('hub-spoke');
  expect(power.capacity).toEqual({ central: 2, perSystem: 1 });   // 2 central + 1 per system
  expect(power.recovery.kind).toBe('power-core');

  // Nothing installed: a tier-1 hull with no coupling stores nothing.
  const bare = { ...emptyShipBuild('Bare'), equipment: [] } as unknown as ShipBuild;
  expect(derivePower(bare, ref)).toMatchObject({ coupling: null, capacity: { central: 0, perSystem: 0 } });
});
