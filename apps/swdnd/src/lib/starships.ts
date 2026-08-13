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
