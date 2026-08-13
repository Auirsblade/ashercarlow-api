// apps/swdnd/src/lib/shipRules/types.ts
// Congruent with lib/rules/types.ts: one stored build document (build + play),
// reference view types mapped from /swdnd/content/starship_* raw_json, and a
// derived sheet that is computed and never stored.

export type ShipAbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type ShipSizeKey = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type ShipRole = 'coordinator' | 'gunner' | 'mechanic' | 'operator' | 'pilot' | 'technician';
export type WeaponMount =
  | 'fixed-forward' | 'fixed-aft' | 'fixed-port' | 'fixed-starboard' | 'turret';
export type ShipEquipmentKind = 'armor' | 'shield' | 'reactor' | 'coupling' | 'hyperdrive' | 'weapon';
export type ShipWeaponCategory = 'primary' | 'secondary' | 'tertiary' | 'quaternary';

// ---- Stored build (starship.data_json) ----
export interface ShipAbilityIncrease {
  source: 'tier';
  ref: string;                     // `t${tier}` — the tier that granted the point
  ability: ShipAbilityKey;
  amount: number;
}
export interface ShipEquipmentEntry {
  /** Stable per-entry id; play.ammoSpent keys off it, so weapons can repeat. */
  id: string;
  ref: string;                     // reference row id
  kind: ShipEquipmentKind;
  mount?: WeaponMount;             // weapons only
}
export interface ShipPlayState {
  hull: number;
  shields: number;
  hullDiceSpent: number;
  shieldDiceSpent: number;
  ammoSpent: Record<string, number>;   // keyed by ShipEquipmentEntry.id
  conditions: string[];                // plain + levelled ('Slowed 1'…'Slowed 4')
  systemDamage: number;                // 0-6, its own field (never a condition string)
  notes: string;
}
export interface ShipBuild {
  schemaVersion: number;
  identity: { name: string; sizeId: string; tier: number };
  abilities: { base: Record<ShipAbilityKey, number>; increases: ShipAbilityIncrease[] };
  equipment: ShipEquipmentEntry[];
  modifications: string[];             // refs into starship_modifications
  play: ShipPlayState;
  /** Assisted-mode manual overrides keyed by derived scalar field name. */
  overrides: Record<string, number>;
  /** Builder steps the player has house-rule-unlocked (additive; absent = none). */
  houseRuled?: string[];
}

// ---- Reference view types (mapped from /swdnd/content/starship_* raw_json) ----
export interface RefShipSize {
  id: string;
  name: string;
  key: ShipSizeKey;
  hullDie: number;                 // 4, 6, 8, 10, 12, 20
  hullDiceStart: number;           // tier-0 dice count
  shieldDie: number;
  shieldDiceStart: number;
  spaceSpeed: number;
  turnSpeed: number;
  hardpointMult: number;
  modBaseCap: number;
  modMaxSuitesBase: number;        // legitimately -1 on Small
  modMaxSuitesMult: number;
  description: string;
}
/** starship_armor holds BOTH hull armor and shield generators. */
export interface RefShipArmor {
  id: string;
  name: string;
  kind: 'armor' | 'shield';
  baseAc: number;
  dexCap: number | null;           // null = uncapped (Lightweight); 0 = Reinforced; 2 = Deflection
  damageReduction: number;
  capacityCoefficient: number | null;  // shields: 1 / 1.5 / 0.667
  regenCoefficient: number | null;     // shields: 1 / 0.667 / 1.5
  price: number | null;
  description: string;
}
export interface RefShipEquipment {
  id: string;
  name: string;
  kind: 'reactor' | 'hyperdrive' | 'coupling' | 'other';
  powerDiceRecovery: string | null;
  hyperdriveClass: number | null;
  centralCapacity: number | null;
  systemCapacity: number | null;
  price: number | null;
  description: string;
}
export interface RefShipWeapon {
  id: string;
  name: string;
  /** 'other' covers the pack's `ammo` and `simpleVW` rows — not installable. */
  category: ShipWeaponCategory | 'other';
  damageParts: Array<[string, string]>; // [formula (may embed @mod), damageType]
  rangeNormal: number | null;
  rangeLong: number | null;
  saveAbility: ShipAbilityKey | '';
  reload: number | null;                // properties.rel
  usesAmmo: boolean;                    // properties.amm
  ammoTypes: string[];
  weaponSize: string | null;
  attackBonus: number;
  price: number | null;
  description: string;
}
export interface RefShipModification {
  id: string;
  name: string;
  system: string;                  // Engineering | Suite | Universal | Weapon | Operation
  grade: number;                   // 0-5
  prerequisite: string | null;     // a modification NAME, in prose
  freeSlot: boolean;
  freeSuite: boolean;
  baseCost: number | null;
  description: string;
}
export interface ShipReferenceData {
  sizes: Record<string, RefShipSize>;
  armor: Record<string, RefShipArmor>;   // includes shields (kind: 'shield')
  equipment: Record<string, RefShipEquipment>;
  weapons: Record<string, RefShipWeapon>;
  modifications: Record<string, RefShipModification>;
}

// ---- Derived ship (computed, never stored) ----
export interface ShipAbilityBlock {
  score: number;
  mod: number;
}
export interface ShipWeaponProfile {
  entryId: string;
  refId: string;
  name: string;
  category: ShipWeaponCategory | 'other';
  mount: WeaponMount;
  /** The SHIP's part of the attack bonus (WIS mod + the weapon's own bonus). */
  attackShipMod: number;
  /** e.g. '+3 + your proficiency' — the crew layer replaces the suffix. */
  attackText: string;
  damageFormula: string;
  damageType: string;
  rangeNormal: number | null;
  rangeLong: number | null;
  saveAbility: ShipAbilityKey | '';
  saveDc: number | null;           // 8 + WIS mod, or null on attack weapons
  reload: number | null;
  usesAmmo: boolean;
}
export interface DerivedShip {
  tier: number;
  abilities: Record<ShipAbilityKey, ShipAbilityBlock>;
  armorClass: number;
  damageReduction: number;
  maxHull: number;
  hullDice: { die: number; count: number };
  maxShields: number;
  shieldDice: { die: number; count: number };
  shieldRegen: number;
  speed: number;
  turnSpeed: number;
  weapons: ShipWeaponProfile[];
  rateOfFireCap: number;
  hardpointsUsed: number;
  hardpointsMax: number;
  modSlotsUsed: number;
  modSlotsMax: number;
  suitesUsed: number;
  suitesMax: number;
}

/**
 * The seed document for a new starship. Hand-duplicated as emptyShipBuildJson
 * in apps/backend/src/routes/swdnd/starships.ts — they cannot share code across
 * the backend/frontend boundary, so keep the two in sync when schemaVersion
 * changes (same convention as emptyBuild / emptyBuildJson for characters).
 */
export function emptyShipBuild(name: string): ShipBuild {
  return {
    schemaVersion: 1,
    identity: { name, sizeId: '', tier: 0 },
    abilities: {
      base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      increases: [],
    },
    equipment: [],
    modifications: [],
    play: {
      hull: 0, shields: 0, hullDiceSpent: 0, shieldDiceSpent: 0,
      ammoSpent: {}, conditions: [], systemDamage: 0, notes: '',
    },
    overrides: {},
    houseRuled: [],
  };
}
