// apps/swdnd/src/lib/characters.ts
import { api } from './api';
import type {
  AbilityKey, CharacterBuild, Progression, RefArchetype, RefArmor, RefClass,
  RefPower, RefSpecies, RefWeapon, ReferenceData, SkillKey,
} from './rules/types';

// ---- REST wrappers ----
export interface CharacterDto {
  id: string; campaign_id: string; player_id: string | null;
  name: string; data_json: CharacterBuild; created_at: string; updated_at: string;
}
export interface PlayerDto {
  id: string; campaign_id: string; name: string; access_token: string; created_at: string;
}

export function listCharacters(campaignId: string) {
  return api<CharacterDto[]>(`/swdnd/campaigns/${campaignId}/characters`);
}
export function getCharacter(id: string) {
  return api<CharacterDto>(`/swdnd/characters/${id}`);
}
export function createCharacter(campaignId: string, name: string, token?: string) {
  return api<CharacterDto>(`/swdnd/campaigns/${campaignId}/characters${token ? `?token=${token}` : ''}`, {
    method: 'POST', body: JSON.stringify({ name }),
  });
}
export function patchCharacter(id: string, patch: { name?: string; data_json?: CharacterBuild }, token?: string) {
  return api<CharacterDto>(`/swdnd/characters/${id}`, {
    method: 'PATCH',
    headers: token ? { 'X-Player-Token': token } : {},
    body: JSON.stringify(patch),
  });
}
export function deleteCharacter(id: string, token?: string) {
  return api<{ ok: boolean }>(`/swdnd/characters/${id}`, {
    method: 'DELETE', headers: token ? { 'X-Player-Token': token } : {},
  });
}
export function createPlayer(campaignId: string, name: string) {
  return api<PlayerDto>(`/swdnd/campaigns/${campaignId}/players`, { method: 'POST', body: JSON.stringify({ name }) });
}
export function getPlayerByToken(token: string) {
  return api<{ player: PlayerDto; characters: Array<{ id: string; name: string; campaign_id: string }> }>(
    `/swdnd/players/me?token=${encodeURIComponent(token)}`,
  );
}

// ---- Reference loader + row mappers (Foundry raw_json -> engine view types) ----
interface Row { id: string; name?: string | null; raw_json: string; [k: string]: unknown }

function system(row: Row): Record<string, any> {
  try { return (JSON.parse(row.raw_json)?.system ?? {}) as Record<string, any>; } catch { return {}; }
}
function prog(v: unknown): Progression {
  return v === 'full' || v === '3/4' || v === 'half' || v === 'arch' ? v : 'none';
}
function asAbility(v: unknown): AbilityKey | undefined {
  return ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(v as string) ? (v as AbilityKey) : undefined;
}

export function mapClassRow(row: Row): RefClass {
  const s = system(row);
  const override: Partial<Record<'force' | 'tech', AbilityKey>> = {};
  const fo = asAbility(s.powercasting?.forceOverride); if (fo) override.force = fo;
  const to = asAbility(s.powercasting?.techOverride); if (to) override.tech = to;
  return {
    id: row.id, name: row.name ?? row.id,
    hitDie: Number(String(s.hitDice ?? 'd6').replace('d', '')) || 6,
    saves: Array.isArray(s.saves) ? (s.saves.filter(asAbility) as AbilityKey[]) : [],
    skillChoices: Array.isArray(s.skills?.choices) ? (s.skills.choices as SkillKey[]) : [],
    skillNumber: Number(s.skills?.number ?? 0),
    powercasting: { force: prog(s.powercasting?.force), tech: prog(s.powercasting?.tech) },
    powercastingOverride: Object.keys(override).length ? override : undefined,
    superiorityProgression: Number(s.superiority?.progression ?? 0) || 0,
  };
}

export function mapArchetypeRow(row: Row): RefArchetype {
  const s = system(row);
  const override: Partial<Record<'force' | 'tech', AbilityKey>> = {};
  const fo = asAbility(s.powercasting?.forceOverride); if (fo) override.force = fo;
  const to = asAbility(s.powercasting?.techOverride); if (to) override.tech = to;
  return {
    id: row.id, name: row.name ?? row.id,
    powercasting: { force: prog(s.powercasting?.force), tech: prog(s.powercasting?.tech) },
    powercastingOverride: Object.keys(override).length ? override : undefined,
    superiorityProgression: Number(s.superiority?.progression ?? 0) || 0,
  };
}

export function mapSpeciesRow(row: Row): RefSpecies {
  const s = system(row);
  return { id: row.id, name: row.name ?? row.id, walkSpeed: Number(s.movement?.walk ?? 30) || 30 };
}

export function mapArmorRow(row: Row): RefArmor {
  const s = system(row);
  const type = s.armor?.type as string | undefined;
  const kind: RefArmor['kind'] = type === 'medium' || type === 'heavy' || type === 'shield' ? type : 'light';
  return {
    id: row.id, name: row.name ?? row.id,
    baseAc: Number(s.armor?.value ?? 10) || 10,
    dexCap: s.armor?.dex == null ? null : Number(s.armor.dex),
    kind,
  };
}

export function mapWeaponRow(row: Row): RefWeapon {
  const s = system(row);
  return {
    id: row.id, name: row.name ?? row.id,
    damageParts: Array.isArray(s.damage?.parts) ? (s.damage.parts as Array<[string, string]>) : [],
    properties: (s.properties ?? {}) as Record<string, unknown>,
    ability: asAbility(s.ability) ?? '',
    attackBonus: Number(s.attackBonus ?? 0) || 0,
  };
}

export function mapPowerRow(row: Row): RefPower {
  const s = system(row);
  return {
    id: row.id, name: row.name ?? row.id,
    level: Number(s.level ?? 0) || 0,
    castType: row.power_type === 'tech' ? 'tech' : 'force',
  };
}

function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/** Fetch the content categories the engine needs and map them into ReferenceData. */
export async function loadReference(): Promise<ReferenceData> {
  const [classes, archetypes, species, armor, weapons, powers] = await Promise.all([
    api<Row[]>('/swdnd/content/classes'),
    api<Row[]>('/swdnd/content/archetypes'),
    api<Row[]>('/swdnd/content/species'),
    api<Row[]>('/swdnd/content/armor'),
    api<Row[]>('/swdnd/content/weapons'),
    api<Row[]>('/swdnd/content/powers'),
  ]);
  return {
    classes: byId(classes.map(mapClassRow)),
    archetypes: byId(archetypes.map(mapArchetypeRow)),
    species: byId(species.map(mapSpeciesRow)),
    armor: byId(armor.map(mapArmorRow)),
    weapons: byId(weapons.map(mapWeaponRow)),
    powers: byId(powers.map(mapPowerRow)),
  };
}
