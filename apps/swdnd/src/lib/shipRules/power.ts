// apps/swdnd/src/lib/shipRules/power.ts
// SotG power dice: die SIZE from ship tier, CAPACITY from the power coupling's
// topology, RECOVERY rate from the reactor. Everything here is display data —
// dice move only when a player taps a counter.
import { POWER_SYSTEMS } from './constants';
import type { PowerDicePool, PowerSystem, ShipBuild, ShipPlayState, ShipReferenceData } from './types';

export type CouplingKind = 'direct' | 'distributed' | 'hub-spoke';
export type ReactorKind = 'fuel-cell' | 'ionization' | 'power-core';

export interface PowerDie { sides: number | null; label: string }
export interface PowerCapacity { central: number; perSystem: number }
export interface ReactorRecovery { kind: ReactorKind | null; formula: string; label: string }
export interface DerivedPower {
  die: PowerDie;
  coupling: CouplingKind | null;
  capacity: PowerCapacity;
  recovery: ReactorRecovery;
}

// Tier 0 ships have no die: each "power die" is a flat 1.
const DIE_BY_TIER: Array<number | null> = [null, 4, 6, 8, 10, 12];

export function powerDieForTier(tier: number): PowerDie {
  const t = Math.max(0, Math.min(DIE_BY_TIER.length - 1, Math.trunc(tier)));
  const sides = DIE_BY_TIER[t];
  return { sides, label: sides === null ? '1' : `d${sides}` };
}

export function couplingKindOf(name: string): CouplingKind | null {
  const n = name.toLowerCase();
  if (!n.includes('coupling')) return null;
  if (n.includes('direct')) return 'direct';
  if (n.includes('distributed')) return 'distributed';
  if (n.includes('hub')) return 'hub-spoke';
  return null;
}

export function reactorKindOf(name: string): ReactorKind | null {
  const n = name.toLowerCase();
  if (!n.includes('reactor')) return null;
  if (n.includes('fuel cell')) return 'fuel-cell';
  if (n.includes('ionization')) return 'ionization';
  if (n.includes('power core')) return 'power-core';
  return null;
}

const CAPACITY: Record<CouplingKind, PowerCapacity> = {
  direct: { central: 4, perSystem: 0 },        // one big capacitor
  distributed: { central: 0, perSystem: 2 },   // no central store at all
  'hub-spoke': { central: 2, perSystem: 1 },   // a bit of both
};

export function powerCapacity(coupling: CouplingKind | null): PowerCapacity {
  return coupling ? { ...CAPACITY[coupling] } : { central: 0, perSystem: 0 };
}

const RECOVERY: Record<ReactorKind, { formula: string; label: string }> = {
  'fuel-cell': { formula: '1', label: '1 die' },
  ionization: { formula: '1d2-1', label: '1d2−1 dice' },
  'power-core': { formula: '1d2', label: '1d2 dice' },
};

export function reactorRecovery(kind: ReactorKind | null): ReactorRecovery {
  return kind ? { kind, ...RECOVERY[kind] } : { kind: null, formula: '0', label: 'no reactor' };
}

export function emptyPowerDice(): PowerDicePool {
  const systems = {} as Record<PowerSystem, number>;
  for (const s of POWER_SYSTEMS) systems[s] = 0;
  return { central: 0, systems };
}

/** Tolerant read: pre-v2 ship documents have no `powerDice` field. */
export function powerDiceOf(play: ShipPlayState): PowerDicePool {
  const stored = play.powerDice;
  if (!stored) return emptyPowerDice();
  const pool = emptyPowerDice();
  pool.central = stored.central ?? 0;
  for (const s of POWER_SYSTEMS) pool.systems[s] = stored.systems?.[s] ?? 0;
  return pool;
}

/**
 * The only function here that touches reference data: the installed coupling
 * and reactor are identified by their pack row NAMES (three of each, stable).
 * `RefShipEquipment.kind` already separates 'coupling' from 'reactor', but the
 * name is still what distinguishes Direct from Distributed from Hub & Spoke.
 */
export function derivePower(build: ShipBuild, ref: ShipReferenceData): DerivedPower {
  let coupling: CouplingKind | null = null;
  let reactor: ReactorKind | null = null;
  for (const entry of build.equipment) {
    const name = ref.equipment[entry.ref]?.name ?? '';
    coupling ??= couplingKindOf(name);
    reactor ??= reactorKindOf(name);
  }
  return {
    die: powerDieForTier(build.identity.tier),
    coupling,
    capacity: powerCapacity(coupling),
    recovery: reactorRecovery(reactor),
  };
}
