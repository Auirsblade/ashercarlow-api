// apps/swdnd/src/lib/scenes.ts — map REST client + DTO types.
import { api } from './api';
import type { GridConfig } from './hex';

export interface SceneDto {
  id: string; campaign_id: string; name: string;
  image_path: string | null; image_w: number | null; image_h: number | null;
  grid_json: GridConfig; fog_json: string[]; initiative_json: unknown | null;
  is_active: number; sort: number; created_at: string; updated_at: string;
}
export interface TokenDto {
  id: string; scene_id: string; character_id: string | null;
  /** Binds this token's vitals to a starship (hull/shields/conditions live on the ship). */
  ship_id: string | null;
  name: string; color: string;
  faction: 'friendly' | 'hostile' | 'neutral'; q: number; r: number; scale: number;
  hp: number | null; max_hp: number | null; conditions_json: string[]; hidden: number;
  image_path: string | null; created_at: string; updated_at: string;
}
export interface TemplateDto {
  id: string; scene_id: string; kind: 'blast' | 'cone' | 'line';
  q: number; r: number; dir: number; size: number;
  q2: number | null; r2: number | null; color: string; created_at: string;
}

const auth = (token?: string | null): Record<string, string> => (token ? { 'X-Player-Token': token } : {});

export const listScenes = (campaignId: string) => api<SceneDto[]>(`/swdnd/campaigns/${campaignId}/scenes`);
export const getScene = (id: string) => api<SceneDto>(`/swdnd/scenes/${id}`);
export const createScene = (campaignId: string, name: string) =>
  api<SceneDto>(`/swdnd/campaigns/${campaignId}/scenes`, { method: 'POST', body: JSON.stringify({ name }) });
export const patchScene = (id: string, patch: { name?: string; grid?: GridConfig; sort?: number }) =>
  api<SceneDto>(`/swdnd/scenes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteScene = (id: string) => api<{ ok: boolean }>(`/swdnd/scenes/${id}`, { method: 'DELETE' });
export const activateScene = (id: string) => api<SceneDto>(`/swdnd/scenes/${id}/activate`, { method: 'POST' });
export const listTokens = (sceneId: string) => api<TokenDto[]>(`/swdnd/scenes/${sceneId}/tokens`);
export const createToken = (sceneId: string, body: Partial<TokenDto> & { name: string }) =>
  api<TokenDto>(`/swdnd/scenes/${sceneId}/tokens`, { method: 'POST', body: JSON.stringify(body) });
export const patchToken = (id: string, body: Record<string, unknown>) =>
  api<TokenDto>(`/swdnd/tokens/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteToken = (id: string) => api<{ ok: boolean }>(`/swdnd/tokens/${id}`, { method: 'DELETE' });
export const moveToken = (id: string, q: number, r: number, token?: string | null) =>
  api<TokenDto>(`/swdnd/tokens/${id}/position`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ q, r }) });

export const patchFog = (id: string, reveal: string[], hide: string[]) =>
  api<SceneDto>(`/swdnd/scenes/${id}/fog`, { method: 'PATCH', body: JSON.stringify({ reveal, hide }) });

export const listTemplates = (sceneId: string) => api<TemplateDto[]>(`/swdnd/scenes/${sceneId}/templates`);
export const createTemplate = (sceneId: string, body: Record<string, unknown>, token?: string | null) =>
  api<TemplateDto>(`/swdnd/scenes/${sceneId}/templates`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
export const patchTemplate = (id: string, body: Record<string, unknown>, token?: string | null) =>
  api<TemplateDto>(`/swdnd/templates/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(body) });
export const deleteTemplate = (id: string, token?: string | null) =>
  api<{ ok: boolean }>(`/swdnd/templates/${id}`, { method: 'DELETE', headers: auth(token) });
export const clearTemplates = (sceneId: string) =>
  api<{ ok: boolean }>(`/swdnd/scenes/${sceneId}/templates`, { method: 'DELETE' });
export const patchInitiative = (sceneId: string, initiative: unknown | null) =>
  api<SceneDto>(`/swdnd/scenes/${sceneId}/initiative`, { method: 'PATCH', body: JSON.stringify({ initiative }) });

export async function uploadSceneImage(sceneId: string, file: File, w: number, h: number): Promise<SceneDto> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('w', String(w));
  fd.append('h', String(h));
  return api<SceneDto>(`/swdnd/scenes/${sceneId}/image`, { method: 'POST', body: fd });
}

export async function uploadTokenImage(tokenId: string, file: File, token?: string | null): Promise<TokenDto> {
  const fd = new FormData();
  fd.append('file', file);
  return api<TokenDto>(`/swdnd/tokens/${tokenId}/image`, { method: 'POST', headers: auth(token), body: fd });
}
export const deleteTokenImage = (tokenId: string, token?: string | null) =>
  api<TokenDto>(`/swdnd/tokens/${tokenId}/image`, { method: 'DELETE', headers: auth(token) });
