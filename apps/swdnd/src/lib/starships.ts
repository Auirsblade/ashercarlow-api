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
import type {
  RefShipArmor, RefShipEquipment, RefShipModification, RefShipSize, RefShipWeapon,
  ShipAbilityKey, ShipSizeKey, ShipWeaponCategory,
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
    baseAc: Number(s.armor?.value ?? 10) || 10,
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
  return {
    id: row.id, name: row.name ?? row.id,
    category: weaponCategoryOf(s.weaponType),
    damageParts: Array.isArray(s.damage?.parts) ? (s.damage.parts as Array<[string, string]>) : [],
    rangeNormal: numOrNull(s.range?.value),
    rangeLong: numOrNull(s.range?.long),
    saveAbility: shipAbilityOf(s.save?.ability),
    reload: typeof props.rel === 'number' ? props.rel : null,
    usesAmmo: props.amm === true,
    ammoTypes: Array.isArray(s.ammo?.types) ? (s.ammo.types as string[]) : [],
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
