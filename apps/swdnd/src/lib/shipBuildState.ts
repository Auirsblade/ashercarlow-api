// apps/swdnd/src/lib/shipBuildState.ts
import { MAX_SHIP_TIER } from './shipRules/constants';
import { maxHull, maxShields } from './shipRules/defense';
import type {
  DerivedShip, ShipAbilityKey, ShipBuild, ShipEquipmentKind, ShipReferenceData, WeaponMount,
} from './shipRules/types';

export type ShipBuildAction =
  | { t: 'setName'; name: string }
  | { t: 'setSize'; sizeId: string }
  | { t: 'setTier'; tier: number }
  | { t: 'setBaseAbilities'; base: Record<ShipAbilityKey, number> }
  | { t: 'allocateTierPoint'; tier: number; ability: ShipAbilityKey; delta: 1 | -1 }
  | { t: 'installEquipment'; ref: string; kind: ShipEquipmentKind; mount?: WeaponMount; id?: string }
  | { t: 'removeEquipment'; id: string }
  | { t: 'setMount'; id: string; mount: WeaponMount }
  | { t: 'toggleModification'; ref: string }
  | { t: 'toggleHouseRule'; step: string };

/** A ship carries at most one of each of these; installing replaces. */
const SINGLE_SLOT: ShipEquipmentKind[] = ['armor', 'shield', 'reactor', 'coupling', 'hyperdrive'];
/** SOTG grants two ability points at each tier. */
const TIER_POINT_BUDGET = 2;

const clone = (b: ShipBuild): ShipBuild => ({
  ...b,
  identity: { ...b.identity },
  abilities: { base: { ...b.abilities.base }, increases: [...b.abilities.increases] },
  equipment: b.equipment.map((e) => ({ ...e })),
  modifications: [...b.modifications],
  play: { ...b.play, conditions: [...b.play.conditions], ammoSpent: { ...b.play.ammoSpent } },
  overrides: { ...b.overrides },
  houseRuled: [...(b.houseRuled ?? [])],
});

/**
 * Shift current hull/shields by their max delta since `before`, clamped to the
 * new maxima — the same rule characters use for maxHp changes, so a full ship
 * stays full when it gains a tier and never goes negative when it shrinks.
 */
function applyPoolDeltas(b: ShipBuild, ref: ShipReferenceData, beforeHull: number, beforeShields: number): void {
  const hullMax = maxHull(b, ref);
  const shieldMax = maxShields(b, ref);
  b.play.hull = Math.max(0, Math.min(hullMax, b.play.hull + (hullMax - beforeHull)));
  b.play.shields = Math.max(0, Math.min(shieldMax, b.play.shields + (shieldMax - beforeShields)));
}

/**
 * The entry's real kind, read from whichever reference table actually holds
 * `refId` — NEVER from the action payload. `starship_armor` doubles up as both
 * hull armor and shield generators (see shipRules/defense.ts's installedOf()),
 * so a caller-supplied `kind` that disagrees with the row it points at would
 * silently corrupt derived AC/shields (that's the exact bug flagged in Task
 * 14's review of defense.ts: it trusts entry.kind and never cross-checks the
 * row). Deriving here means a mistagged install can never happen in the first
 * place. Returns undefined for an unresolvable or non-installable ref (e.g. a
 * weapon-pack 'other' row, or an equipment 'other' row), which callers treat
 * as "refuse the install".
 */
function deriveEquipmentKind(ref: ShipReferenceData, refId: string): ShipEquipmentKind | undefined {
  const armor = ref.armor[refId];
  if (armor) return armor.kind; // 'armor' | 'shield' — both are valid ShipEquipmentKind values
  const weapon = ref.weapons[refId];
  if (weapon) return weapon.category === 'other' ? undefined : 'weapon';
  const equipment = ref.equipment[refId];
  if (equipment && equipment.kind !== 'other') return equipment.kind; // 'reactor' | 'hyperdrive' | 'coupling'
  return undefined;
}

export function applyShipBuildAction(
  build: ShipBuild,
  ref: ShipReferenceData,
  derived: DerivedShip,
  action: ShipBuildAction,
): ShipBuild {
  const b = clone(build);

  switch (action.t) {
    case 'setName':
      b.identity.name = action.name;
      break;

    case 'setSize': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      b.identity.sizeId = action.sizeId;
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'setTier': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      const tier = Math.max(0, Math.min(MAX_SHIP_TIER, Math.floor(action.tier)));
      b.identity.tier = tier;
      // Points granted by tiers the ship no longer has go away with them.
      b.abilities.increases = b.abilities.increases.filter((i) => Number(i.ref.slice(1)) <= tier);
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'setBaseAbilities': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      b.abilities.base = { ...action.base };
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'allocateTierPoint': {
      const tierRef = `t${action.tier}`;
      if (action.tier > b.identity.tier || action.tier < 1) break;
      if (action.delta === -1) {
        const idx = b.abilities.increases.findIndex((i) => i.ref === tierRef && i.ability === action.ability);
        if (idx >= 0) b.abilities.increases.splice(idx, 1);
        break;
      }
      const spent = b.abilities.increases.filter((i) => i.ref === tierRef).reduce((s, i) => s + i.amount, 0);
      if (spent >= TIER_POINT_BUDGET) break;
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      b.abilities.increases.push({ source: 'tier', ref: tierRef, ability: action.ability, amount: 1 });
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'installEquipment': {
      // Derive the entry's kind from the ref row itself; action.kind is never
      // trusted (see deriveEquipmentKind's doc comment / Task 14 carry-forward).
      const kind = deriveEquipmentKind(ref, action.ref);
      if (!kind) break;
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      if (SINGLE_SLOT.includes(kind)) {
        b.equipment = b.equipment.filter((e) => e.kind !== kind);
      }
      const entry = { id: action.id ?? crypto.randomUUID(), ref: action.ref, kind };
      b.equipment.push(action.mount ? { ...entry, mount: action.mount } : entry);
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'removeEquipment': {
      const beforeHull = maxHull(build, ref);
      const beforeShields = maxShields(build, ref);
      b.equipment = b.equipment.filter((e) => e.id !== action.id);
      delete b.play.ammoSpent[action.id]; // the counter is keyed by entry id
      applyPoolDeltas(b, ref, beforeHull, beforeShields);
      break;
    }

    case 'setMount': {
      const entry = b.equipment.find((e) => e.id === action.id);
      if (entry) entry.mount = action.mount;
      break;
    }

    case 'toggleModification': {
      const idx = b.modifications.indexOf(action.ref);
      if (idx >= 0) { b.modifications.splice(idx, 1); break; } // removal always allowed
      if (!ref.modifications[action.ref]) break;
      b.modifications.push(action.ref);
      break;
    }

    case 'toggleHouseRule': {
      const list = b.houseRuled ?? [];
      const i = list.indexOf(action.step);
      if (i >= 0) list.splice(i, 1);
      else list.push(action.step);
      b.houseRuled = list;
      break;
    }
  }

  // `derived` is part of the signature for symmetry with applyBuildAction (and
  // for future budget-blocking rules); the spine's validation warns rather than
  // blocks, so no action consults it yet.
  void derived;
  return b;
}
