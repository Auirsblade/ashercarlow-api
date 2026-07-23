// apps/swdnd/src/lib/rules/types.ts
export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type Alignment = 'light' | 'dark' | 'universal' | 'none';
export type CastType = 'force' | 'tech';
export type Progression = 'full' | '3/4' | 'half' | 'arch' | 'none';
export type SkillKey =
  | 'acr' | 'ani' | 'ath' | 'dec' | 'ins' | 'itm' | 'inv' | 'lor' | 'med'
  | 'nat' | 'prc' | 'prf' | 'per' | 'pil' | 'slt' | 'ste' | 'sur' | 'tec';

// ---- Stored build (character.data_json) ----
export interface AbilityIncrease {
  source: 'species' | 'asi' | 'feat';
  ref: string;
  ability: AbilityKey;
  amount: number;
}
export interface LevelEntry {
  n: number;                       // 1-based overall character level for this entry
  classId: string;
  archetypeId: string | null;
  hp: 'avg' | number;             // 'avg' or a rolled total for this level's die
  choices?: Record<string, unknown>;
}
export interface EquipmentEntry {
  ref: string;
  qty: number;
  equipped: boolean;
  mods?: string[];
}
export interface PlayState {
  hp: number;
  tempHp: number;
  hitDiceSpent: number;
  forcePointsSpent: number;
  techPointsSpent: number;
  superiorityDiceSpent: number;
  conditions: string[];
  exhaustion: number;
  inspiration: boolean;
  notes: string;
}
export interface CharacterBuild {
  schemaVersion: number;
  identity: {
    name: string;
    speciesId: string;
    backgroundId: string;
    alignment: Alignment;
    /** For universal forcecasters: the chosen casting ability. */
    forceCastingAbility?: 'wis' | 'cha';
  };
  abilities: {
    base: Record<AbilityKey, number>;
    increases: AbilityIncrease[];
  };
  levels: LevelEntry[];
  proficiencies: {
    skills: SkillKey[];
    expertise: SkillKey[];
    tools: string[];
    languages: string[];
    savingThrows: AbilityKey[];
  };
  equipment: EquipmentEntry[];
  credits: number;
  knownPowers: string[];
  knownManeuvers: string[];
  play: PlayState;
  /** Assisted-mode manual overrides keyed by derived scalar field name. */
  overrides: Record<string, number>;
  /** Step keys the player has house-rule-unlocked (additive; absent = none). */
  houseRuled?: string[];
}

// ---- Reference view types (mapped from /swdnd/content/:category raw_json) ----
export interface RefClass {
  id: string;
  name: string;
  hitDie: number;                 // 6, 8, 10, 12
  saves: AbilityKey[];
  skillChoices: SkillKey[];
  skillNumber: number;
  powercasting: Record<CastType, Progression>;
  powercastingOverride?: Partial<Record<CastType, AbilityKey>>;
  superiorityProgression: number; // 0 when none
  description: string;
  /** sw5e slug (system.identifier, e.g. 'fighter') linking archetypes to classes. */
  identifier: string;
  /** CLASS levels that grant an ASI (from advancement), e.g. [4, 6, 8, 12, 14, 16, 19]. */
  asiLevels: number[];
}
export interface RefArchetype {
  id: string;
  name: string;
  powercasting: Record<CastType, Progression>;
  powercastingOverride?: Partial<Record<CastType, AbilityKey>>;
  superiorityProgression: number;
  /** Matches RefClass.identifier of the parent class (system.classIdentifier). */
  classIdentifier: string;
  description: string;
}
export interface RefSpecies {
  id: string;
  name: string;
  walkSpeed: number;
  description: string;
  abilityIncreases: { fixed: Partial<Record<AbilityKey, number>>; points: number } | null;
}
export interface RefArmor {
  id: string;
  name: string;
  baseAc: number;
  dexCap: number | null;          // null = no cap (light); 0 = heavy; n = medium cap
  kind: 'light' | 'medium' | 'heavy' | 'shield';
  price: number | null;
  description: string;
}
export interface RefWeapon {
  id: string;
  name: string;
  damageParts: Array<[string, string]>; // [formula, damageType]
  properties: Record<string, unknown>;  // sw5e weapon properties (fin, dex, ran, ...)
  ability: AbilityKey | '';
  attackBonus: number;
  price: number | null;
  description: string;
}
export interface RefPower {
  id: string;
  name: string;
  level: number;                  // 0 = at-will
  castType: CastType;
  description: string;
}
export interface RefBackground {
  id: string;
  name: string;
  description: string;
  featureName: string | null;
  skillProse: string | null;
  toolProse: string | null;
  equipmentProse: string | null;
}
export interface RefFeat {
  id: string;
  name: string;
  description: string;
  requirements: string | null;
}
export interface RefManeuver {
  id: string;
  name: string;
  maneuverType: string;
  description: string;
}
export interface RefGear {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  description: string;
}
export interface ReferenceData {
  classes: Record<string, RefClass>;
  archetypes: Record<string, RefArchetype>;
  species: Record<string, RefSpecies>;
  armor: Record<string, RefArmor>;
  weapons: Record<string, RefWeapon>;
  powers: Record<string, RefPower>;
  backgrounds: Record<string, RefBackground>;
  feats: Record<string, RefFeat>;
  maneuvers: Record<string, RefManeuver>;
  gear: Record<string, RefGear>;
}

// ---- Derived sheet (computed, never stored) ----
export interface AbilityBlock {
  score: number;
  mod: number;
}
export interface TrackCasting {
  classes: number;
  casterLevel: number;
  maxPowerLevel: number;
  pointsMax: number;
  knownMax: number;
  ability: AbilityKey | null;
  saveDc: number | null;
  attackBonus: number | null;
}
export interface SuperiorityBlock {
  level: number;
  diceMax: number;
  die: string;                    // e.g. 'd8'
  knownMax: number;
}
export interface SkillBonus {
  key: SkillKey;
  ability: AbilityKey;
  bonus: number;
  proficient: boolean;
  expertise: boolean;
}
export interface DerivedSheet {
  totalLevel: number;
  proficiencyBonus: number;
  abilities: Record<AbilityKey, AbilityBlock>;
  maxHp: number;
  armorClass: number;
  initiative: number;
  speed: number;
  hitDice: Record<string, number>; // { d10: 3, d6: 2 }
  savingThrows: Record<AbilityKey, { bonus: number; proficient: boolean }>;
  skills: SkillBonus[];
  casting: { force: TrackCasting; tech: TrackCasting };
  superiority: SuperiorityBlock | null;
}

export function emptyBuild(name: string): CharacterBuild {
  return {
    schemaVersion: 1,
    identity: { name, speciesId: '', backgroundId: '', alignment: 'none' },
    abilities: {
      base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      increases: [],
    },
    levels: [],
    proficiencies: { skills: [], expertise: [], tools: [], languages: [], savingThrows: [] },
    equipment: [],
    credits: 0,
    knownPowers: [],
    knownManeuvers: [],
    play: {
      hp: 0, tempHp: 0, hitDiceSpent: 0, forcePointsSpent: 0, techPointsSpent: 0,
      superiorityDiceSpent: 0, conditions: [], exhaustion: 0, inspiration: false, notes: '',
    },
    overrides: {},
    houseRuled: [],
  };
}
