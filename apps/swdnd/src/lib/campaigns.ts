// apps/swdnd/src/lib/campaigns.ts — campaign DTO + REST wrappers.
import { api } from './api';

export interface CampaignDto {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export function listCampaigns() {
  return api<CampaignDto[]>('/swdnd/campaigns');
}
export function getCampaign(id: string) {
  return api<CampaignDto>(`/swdnd/campaigns/${id}`);
}
export function createCampaign(name: string) {
  return api<CampaignDto>('/swdnd/campaigns', { method: 'POST', body: JSON.stringify({ name }) });
}
export function renameCampaign(id: string, name: string) {
  return api<CampaignDto>(`/swdnd/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}
