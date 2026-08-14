// apps/swdnd/src/lib/starships.ts
// Mirrors lib/characters.ts's single-file layout: DTOs + REST wrappers, then
// row mappers, then the reference loader.
import { api } from './api';
import type { ShipBuild, ShipRole } from './shipRules/types';

// ---- REST wrappers ----
export interface ShipCrewMember {
  character_id: string;
  character_name: string;
  role: ShipRole;
}
export interface StarshipDto {
  id: string; campaign_id: string; name: string;
  data_json: ShipBuild; created_at: string; updated_at: string;
  crew: ShipCrewMember[];
}

const auth = (token?: string | null): Record<string, string> => (token ? { 'X-Player-Token': token } : {});

export function listStarships(campaignId: string) {
  return api<StarshipDto[]>(`/swdnd/campaigns/${campaignId}/starships`);
}
export function getStarship(id: string) {
  return api<StarshipDto>(`/swdnd/starships/${id}`);
}
export function createStarship(
  campaignId: string,
  name: string,
  crew?: { characterId: string; role: ShipRole },
  token?: string | null,
) {
  // The token rides in the query string (not a header) so it survives the
  // creation route's player lookup exactly like createCharacter does.
  return api<StarshipDto>(
    `/swdnd/campaigns/${campaignId}/starships${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    { method: 'POST', body: JSON.stringify(crew ? { name, crew } : { name }) },
  );
}
export function patchStarship(id: string, patch: { name?: string; data_json?: ShipBuild }, token?: string | null) {
  return api<StarshipDto>(`/swdnd/starships/${id}`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify(patch),
  });
}
export function deleteStarship(id: string, token?: string | null) {
  return api<{ ok: boolean }>(`/swdnd/starships/${id}`, { method: 'DELETE', headers: auth(token) });
}
export function putShipCrew(id: string, body: { characterId: string; role: ShipRole }, token?: string | null) {
  return api<StarshipDto>(`/swdnd/starships/${id}/crew`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify(body),
  });
}
export function deleteShipCrew(id: string, body: { characterId: string; role?: ShipRole }, token?: string | null) {
  return api<StarshipDto>(`/swdnd/starships/${id}/crew`, {
    method: 'DELETE', headers: auth(token), body: JSON.stringify(body),
  });
}

// ---- Reference row mappers (Foundry raw_json -> engine view types) ----
import { cleanRichText } from './richText';
import { SHIP_ROLES } from './shipRules/constants';
import type {
  DeploymentReferenceData, PowerSystem, RefDeployment, RefDeploymentFeature,
  RefShipArmor, RefShipEquipment, RefShipModification, RefShipSize, RefShipWeapon,
  ShipAbilityKey, ShipReferenceData, ShipSizeKey, ShipWeaponCategory,
} from './shipRules/types';

interface ShipRow { id: string; name?: string | null; raw_json: string; [k: string]: unknown }

function system(row: ShipRow): Record<string, any> {
  try { return (JSON.parse(row.raw_json)?.system ?? {}) as Record<string, any>; } catch { return {}; }
}
function proseOf(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as { value?: unknown }).value;
    return typeof inner === 'string' && inner ? inner : null;
  }
  return null;
}
function descriptionOf(s: Record<string, any>): string {
  return cleanRichText(proseOf(s.description));
}
function priceOf(s: Record<string, any>): number | null {
  const v = s.price?.value;
  return typeof v === 'number' ? v : null;
}
function dieOf(v: unknown, fallback: number): number {
  return Number(String(v ?? '').replace('d', '')) || fallback;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const SIZE_KEYS: ShipSizeKey[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
function sizeKeyOf(v: unknown): ShipSizeKey {
  return SIZE_KEYS.includes(v as ShipSizeKey) ? (v as ShipSizeKey) : 'medium';
}

export function mapShipSizeRow(row: ShipRow): RefShipSize {
  const s = system(row);
  return {
    id: row.id, name: row.name ?? row.id, key: sizeKeyOf(s.identifier),
    hullDie: dieOf(s.hullDice, 8),
    hullDiceStart: Number(s.hullDiceStart ?? 1) || 1,
    shieldDie: dieOf(s.shldDice, 8),
    shieldDiceStart: Number(s.shldDiceStart ?? 1) || 1,
    spaceSpeed: Number(s.baseSpaceSpeed ?? 300) || 300,
    turnSpeed: Number(s.baseTurnSpeed ?? 0) || 0,
    hardpointMult: Number(s.hardpointMult ?? 1) || 1,
    modBaseCap: Number(s.modBaseCap ?? 0) || 0,
    // modMaxSuitesBase is legitimately -1 on Small -> do NOT use `|| 0`.
    modMaxSuitesBase: Number.isFinite(Number(s.modMaxSuitesBase)) ? Number(s.modMaxSuitesBase) : 0,
    modMaxSuitesMult: Number(s.modMaxSuitesMult ?? 0) || 0,
    description: descriptionOf(s),
  };
}

/**
 * starship_armor holds BOTH hull armor (`armor.type === 'starship'`) and shield
 * generators (`armor.type === 'ssshield'`), so one mapper covers both and the
 * `kind` discriminator sorts them at the call site.
 */
export function mapShipArmorRow(row: ShipRow): RefShipArmor {
  const s = system(row);
  const attrs = s.attributes ?? {};
  const isShield = s.armor?.type === 'ssshield';
  return {
    id: row.id, name: row.name ?? row.id,
    kind: isShield ? 'shield' : 'armor',
    // Every real ssshield row stores armor.value: 0 — `Number(v ?? 10) || 10`
    // would coerce that legit 0 to 10 via `||`. Preserve 0, default only when absent.
    baseAc: numOrNull(s.armor?.value) ?? 10,
    dexCap: s.armor?.dex == null ? null : Number(s.armor.dex),
    damageReduction: Number(attrs.dmgred?.value ?? 0) || 0,
    capacityCoefficient: numOrNull(attrs.capx?.value),
    regenCoefficient: numOrNull(attrs.regrateco?.value),
    price: priceOf(s),
    description: descriptionOf(s),
  };
}

export function mapShipEquipmentRow(row: ShipRow): RefShipEquipment {
  const s = system(row);
  const attrs = s.attributes ?? {};
  const type = s.armor?.type as string | undefined;
  const kind: RefShipEquipment['kind'] =
    type === 'reactor' ? 'reactor' : type === 'hyper' ? 'hyperdrive' : type === 'powerc' ? 'coupling' : 'other';
  const rec = attrs.powerdicerec?.value;
  return {
    id: row.id, name: row.name ?? row.id, kind,
    powerDiceRecovery: typeof rec === 'string' && rec ? rec : null,
    hyperdriveClass: numOrNull(attrs.hdclass?.value),
    centralCapacity: numOrNull(attrs.cscap?.value),
    systemCapacity: numOrNull(attrs.sscap?.value),
    price: priceOf(s),
    description: descriptionOf(s),
  };
}

const WEAPON_CATEGORIES: ShipWeaponCategory[] = ['primary', 'secondary', 'tertiary', 'quaternary'];
function weaponCategoryOf(v: unknown): ShipWeaponCategory | 'other' {
  // Rows read "primary (starship)"; the pack also carries "ammo" and "simpleVW"
  // rows which are NOT installable weapons and map to 'other'.
  const head = String(v ?? '').split(' ')[0];
  return WEAPON_CATEGORIES.includes(head as ShipWeaponCategory) ? (head as ShipWeaponCategory) : 'other';
}
function shipAbilityOf(v: unknown): ShipAbilityKey | '' {
  return ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(v as string) ? (v as ShipAbilityKey) : '';
}

export function mapShipWeaponRow(row: ShipRow): RefShipWeapon {
  const s = system(row);
  const props = (s.properties ?? {}) as Record<string, unknown>;
  const size = s.weaponSize;
  const ammoTypes = Array.isArray(s.ammo?.types) ? (s.ammo.types as string[]) : [];
  return {
    id: row.id, name: row.name ?? row.id,
    category: weaponCategoryOf(s.weaponType),
    damageParts: Array.isArray(s.damage?.parts) ? (s.damage.parts as Array<[string, string]>) : [],
    rangeNormal: numOrNull(s.range?.value),
    rangeLong: numOrNull(s.range?.long),
    saveAbility: shipAbilityOf(s.save?.ability),
    saveDc: numOrNull(s.save?.dc),
    reload: typeof props.rel === 'number' ? props.rel : null,
    // Real launchers (Assault rocket pod launcher, Rocket pod launcher) omit
    // properties.amm entirely, even though they carry ammo.types + a reload
    // value — fall back to ammoTypes.length so those aren't misread as ammo-less.
    usesAmmo: props.amm === true || ammoTypes.length > 0,
    ammoTypes,
    weaponSize: typeof size === 'string' && size ? size : null,
    // attackBonus is sometimes the STRING "0" in the pack.
    attackBonus: Number(s.attackBonus ?? 0) || 0,
    price: priceOf(s),
    description: descriptionOf(s),
  };
}

export function mapShipModRow(row: ShipRow): RefShipModification {
  const s = system(row);
  return {
    id: row.id, name: row.name ?? row.id,
    system: proseOf(s.system) ?? '',
    grade: Number(s.grade?.value ?? 0) || 0,
    prerequisite: proseOf(s.prerequisites),
    freeSlot: s.free?.slot === true,
    freeSuite: s.free?.suite === true,
    baseCost: numOrNull(s.basecost?.value),
    description: descriptionOf(s),
  };
}

const ROLE_SET = new Set<string>(SHIP_ROLES);
function asRole(v: unknown): ShipRole | null {
  const k = String(v ?? '').trim().toLowerCase();
  return ROLE_SET.has(k) ? (k as ShipRole) : null;
}

export function mapDeploymentRow(row: ShipRow): RefDeployment {
  const s = system(row);
  const name = row.name ?? row.id;
  return { id: row.id, name, role: asRole(name), description: descriptionOf(s) };
}

// "Technician 1st Rank" / "Gunner 4th Rank" / "Universal 1st Rank" — the only
// machine-readable link between a feature and its deployment + rank.
const REQUIREMENT_RE = /^\s*([A-Za-z]+)\s+(\d+)(?:st|nd|rd|th)\s+rank/i;
const POWER_TARGET_RE = /^attributes\.power\.(comms|engines|shields|sensors|weapons)\.value$/;

export function mapDeploymentFeatureRow(row: ShipRow): RefDeploymentFeature {
  const s = system(row);
  const m = REQUIREMENT_RE.exec(typeof s.requirements === 'string' ? s.requirements : '');
  const target = typeof s.consume?.target === 'string' ? s.consume.target : '';
  const ps = POWER_TARGET_RE.exec(target);
  return {
    id: row.id,
    name: row.name ?? row.id,
    role: (m ? asRole(m[1]) : null) ?? 'universal',
    rank: m ? Number(m[2]) : 0,
    powerSystem: ps ? (ps[1] as PowerSystem) : null,
    activation: typeof s.activation?.type === 'string' ? s.activation.type : '',
    description: descriptionOf(s),
  };
}

// ---- Reference loader ----
function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/**
 * Two requests, fetched on demand. Ship screens get these through
 * loadShipReference(); the character sheet's Deployments UI calls this directly
 * rather than growing the ten-request character loader.
 */
export async function loadDeploymentReference(): Promise<DeploymentReferenceData> {
  const [deployments, features] = await Promise.all([
    api<ShipRow[]>('/swdnd/content/deployments'),
    api<ShipRow[]>('/swdnd/content/deployment_features'),
  ]);
  return {
    deployments: byId(deployments.map(mapDeploymentRow)),
    deploymentFeatures: byId(features.map(mapDeploymentFeatureRow)),
  };
}

/**
 * Fetch the starship content categories the engine needs.
 *
 * DELIBERATELY SEPARATE from loadReference(): ship data loads only on ship
 * screens, because the character loader already fires 10 requests on every
 * panel mount and no character screen needs starship rows.
 *
 * Folds in loadDeploymentReference() (crew layer, sub-project 2) so ship
 * screens pay nothing extra for it; `ventures` stays out, and
 * starship_features / starship_actions stay out of the spine, because
 * nothing computes from them yet.
 */
export async function loadShipReference(): Promise<ShipReferenceData> {
  const [sizes, armor, equipment, weapons, modifications, deploymentRef] = await Promise.all([
    api<ShipRow[]>('/swdnd/content/starship_sizes'),
    api<ShipRow[]>('/swdnd/content/starship_armor'),
    api<ShipRow[]>('/swdnd/content/starship_equipment'),
    api<ShipRow[]>('/swdnd/content/starship_weapons'),
    api<ShipRow[]>('/swdnd/content/starship_modifications'),
    loadDeploymentReference(),
  ]);
  return {
    sizes: byId(sizes.map(mapShipSizeRow)),
    armor: byId(armor.map(mapShipArmorRow)),
    equipment: byId(equipment.map(mapShipEquipmentRow)),
    weapons: byId(weapons.map(mapShipWeaponRow)),
    modifications: byId(modifications.map(mapShipModRow)),
    ...deploymentRef,
  };
}

// ---- Stock ships (drakes-shipyard pack -> the `starships` content table) ----
// Rows are distilled Foundry ACTOR documents (see distillStockShip in the
// backend importer): same field paths as the raw pack, essentials only.

export interface StockShipRow { id: string; name?: string | null; raw_json: string }

export interface StockShipItem {
  name: string;
  /** Reference row id from flags.core.sourceId; null when the pack omits it. */
  ref: string | null;
  /** system.armor.type on equipment: starship|ssshield|reactor|powerc|hyper|''. */
  armorType: string;
  /** system.weaponType on weapons: 'primary (starship)'…'quaternary (starship)'. */
  weaponType: string;
}

export interface StockShipView {
  id: string;
  name: string;
  sizeRef: string | null;
  sizeName: string;
  tier: number;
  abilities: Record<ShipAbilityKey, number>;
  hull: number | null;
  shields: number | null;
  source: string;
  weapons: StockShipItem[];
  equipment: StockShipItem[];
  modifications: StockShipItem[];
}

const STOCK_ABILITY_KEYS: ShipAbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Size names in chassis order; anything unknown sorts last, alphabetically. */
const SIZE_ORDER = [
  'Tiny Starship', 'Small Starship', 'Medium Starship',
  'Large Starship', 'Huge Starship', 'Gargantuan Starship',
];

function stockNum(v: unknown): number | null {
  const n = Number(v);
  return typeof v === 'boolean' || v === null || v === undefined || v === '' || !Number.isFinite(n)
    ? null
    : n;
}

/** 'Compendium.sw5e.starshipweapons.A0LPvkVHhH3e2Aeh' -> 'A0LPvkVHhH3e2Aeh'. */
export function sourceRef(sourceId: unknown): string | null {
  if (typeof sourceId !== 'string') return null;
  const parts = sourceId.split('.');
  return parts.length === 4 && parts[3] ? parts[3] : null;
}

function stockItem(it: any): StockShipItem {
  return {
    name: typeof it?.name === 'string' ? it.name : '',
    ref: sourceRef(it?.flags?.core?.sourceId),
    armorType: typeof it?.system?.armor?.type === 'string' ? it.system.armor.type : '',
    weaponType: typeof it?.system?.weaponType === 'string' ? it.system.weaponType : '',
  };
}

/** Parse one `starships` content row into a display view. Never throws. */
export function parseStockShip(row: StockShipRow): StockShipView {
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(row.raw_json) ?? {}; } catch { /* unparsable -> empty view */ }
  const sys: Record<string, any> = raw.system ?? {};
  const items: any[] = Array.isArray(raw.items) ? raw.items : [];
  const sizeItem = items.find((it) => it?.type === 'starshipsize') ?? null;
  const hp: Record<string, any> = sys.attributes?.hp ?? {};

  const abilities = {} as Record<ShipAbilityKey, number>;
  for (const k of STOCK_ABILITY_KEYS) abilities[k] = stockNum(sys.abilities?.[k]?.value) ?? 10;

  return {
    id: row.id,
    name: row.name || (typeof raw.name === 'string' ? raw.name : row.id),
    sizeRef: sourceRef(sizeItem?.flags?.core?.sourceId),
    sizeName: typeof sizeItem?.name === 'string' ? sizeItem.name : '',
    tier: stockNum(sys.details?.tier) ?? stockNum(sizeItem?.system?.tier) ?? 0,
    abilities,
    hull: stockNum(hp.max) ?? stockNum(hp.value),
    shields: stockNum(hp.tempmax) ?? stockNum(hp.temp),
    source: typeof sys.details?.source === 'string' ? sys.details.source : '',
    weapons: items.filter((it) => it?.type === 'weapon').map(stockItem),
    equipment: items.filter((it) => it?.type === 'equipment').map(stockItem),
    modifications: items.filter((it) => it?.type === 'starshipmod').map(stockItem),
  };
}

export interface StockShipFilter { q: string; size?: string; tierMin?: number; tierMax?: number }

export function filterStockShips(list: StockShipView[], f: StockShipFilter): StockShipView[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (f.size && s.sizeName !== f.size) return false;
    if (f.tierMin !== undefined && s.tier < f.tierMin) return false;
    if (f.tierMax !== undefined && s.tier > f.tierMax) return false;
    return true;
  });
}

export function stockShipSizes(list: StockShipView[]): string[] {
  const present = [...new Set(list.map((s) => s.sizeName).filter(Boolean))];
  return present.sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a);
    const ib = SIZE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export const listStockShips = () => api<StockShipRow[]>('/swdnd/content/starships');
