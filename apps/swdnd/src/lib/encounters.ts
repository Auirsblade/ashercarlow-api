// apps/swdnd/src/lib/encounters.ts — encounter DTO, REST wrappers, and
// immutable monster-list edit helpers for the encounter editor.
import { api } from './api';

export interface EncounterMonster { monsterId: string; count: number }
/** A stock-ship member: a `starships` reference row id, instantiated at spawn. */
export interface EncounterShip { stockShipRef: string; count: number }
export interface EncounterDto {
  id: string;
  campaign_id: string;
  name: string;
  monsters_json: EncounterMonster[];
  ships_json: EncounterShip[];
  sort: number;
  created_at: string;
  updated_at: string;
}

export const listEncounters = (campaignId: string) =>
  api<EncounterDto[]>(`/swdnd/campaigns/${campaignId}/encounters`);
export const createEncounter = (
  campaignId: string, name: string, monsters?: EncounterMonster[], ships?: EncounterShip[],
) =>
  api<EncounterDto>(`/swdnd/campaigns/${campaignId}/encounters`, {
    method: 'POST',
    body: JSON.stringify({ name, ...(monsters ? { monsters } : {}), ...(ships ? { ships } : {}) }),
  });
export const patchEncounter = (
  id: string,
  patch: { name?: string; monsters?: EncounterMonster[]; ships?: EncounterShip[]; sort?: number },
) => api<EncounterDto>(`/swdnd/encounters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteEncounter = (id: string) =>
  api<{ ok: boolean }>(`/swdnd/encounters/${id}`, { method: 'DELETE' });

export function addMonster(list: EncounterMonster[], monsterId: string): EncounterMonster[] {
  return list.some((m) => m.monsterId === monsterId)
    ? list.map((m) => (m.monsterId === monsterId ? { ...m, count: m.count + 1 } : m))
    : [...list, { monsterId, count: 1 }];
}

export function setCount(list: EncounterMonster[], monsterId: string, count: number): EncounterMonster[] {
  if (!list.some((m) => m.monsterId === monsterId)) return list;
  if (count <= 0) return list.filter((m) => m.monsterId !== monsterId);
  return list.map((m) => (m.monsterId === monsterId ? { ...m, count } : m));
}

export function removeMonster(list: EncounterMonster[], monsterId: string): EncounterMonster[] {
  return list.filter((m) => m.monsterId !== monsterId);
}

export function totalCount(list: EncounterMonster[]): number {
  return list.reduce((sum, m) => sum + m.count, 0);
}

export function addStockShip(list: EncounterShip[], stockShipRef: string): EncounterShip[] {
  return list.some((s) => s.stockShipRef === stockShipRef)
    ? list.map((s) => (s.stockShipRef === stockShipRef ? { ...s, count: s.count + 1 } : s))
    : [...list, { stockShipRef, count: 1 }];
}

export function setShipCount(list: EncounterShip[], stockShipRef: string, count: number): EncounterShip[] {
  if (!list.some((s) => s.stockShipRef === stockShipRef)) return list;
  if (count <= 0) return list.filter((s) => s.stockShipRef !== stockShipRef);
  return list.map((s) => (s.stockShipRef === stockShipRef ? { ...s, count } : s));
}

export function removeStockShip(list: EncounterShip[], stockShipRef: string): EncounterShip[] {
  return list.filter((s) => s.stockShipRef !== stockShipRef);
}

export function totalShipCount(list: EncounterShip[]): number {
  return list.reduce((sum, s) => sum + s.count, 0);
}
