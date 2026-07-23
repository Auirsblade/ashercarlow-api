// apps/backend/src/routes/swdnd/scenes.test.ts
import { beforeAll, describe, expect, it } from 'bun:test';
import { createApiApp } from '../../lib/openapi';
import { swdndDb } from '../../db/swdnd';

const app = createApiApp();
const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

let campaignId: string;

beforeAll(async () => {
  swdndDb.exec('DELETE FROM token; DELETE FROM scene; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  const res = await app.request('/swdnd/campaigns', json('POST', { name: 'Map Camp' }));
  campaignId = ((await res.json()) as { id: string }).id;
});

describe('swdnd scenes', () => {
  let sceneId: string;

  it('creates a scene with default grid and lists it', async () => {
    const res = await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Cantina' }));
    expect(res.status).toBe(201);
    const scene = (await res.json()) as any;
    sceneId = scene.id;
    expect(scene.name).toBe('Cantina');
    expect(scene.is_active).toBe(0);
    expect(scene.grid_json.orientation).toBe('pointy');
    expect(scene.grid_json.unitsPerHex).toBe(5);

    const list = await app.request(`/swdnd/campaigns/${campaignId}/scenes`);
    expect(list.status).toBe(200);
    expect(((await list.json()) as any[]).map((s) => s.id)).toContain(sceneId);
  });

  it('gets one scene; 404s on unknown', async () => {
    expect((await app.request(`/swdnd/scenes/${sceneId}`)).status).toBe(200);
    expect((await app.request('/swdnd/scenes/nope')).status).toBe(404);
  });

  it('patches name and grid (partial)', async () => {
    const res = await app.request(`/swdnd/scenes/${sceneId}`, json('PATCH', {
      name: 'Cantina Brawl',
      grid: { orientation: 'flat', hexSize: 42, originX: 10, originY: 20, unitsPerHex: 5, unitLabel: 'ft' },
    }));
    expect(res.status).toBe(200);
    const s = (await res.json()) as any;
    expect(s.name).toBe('Cantina Brawl');
    expect(s.grid_json.hexSize).toBe(42);
  });

  it('activate flips the single active scene per campaign', async () => {
    const res2 = await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Street' }));
    const scene2 = ((await res2.json()) as any).id as string;

    expect((await app.request(`/swdnd/scenes/${sceneId}/activate`, json('POST'))).status).toBe(200);
    expect((await app.request(`/swdnd/scenes/${scene2}/activate`, json('POST'))).status).toBe(200);

    const list = (await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`)).json()) as any[];
    expect(list.filter((s) => s.is_active === 1).map((s) => s.id)).toEqual([scene2]);
  });

  it('deletes a scene', async () => {
    const res = await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Doomed' }));
    const id = ((await res.json()) as any).id as string;
    expect((await app.request(`/swdnd/scenes/${id}`, json('DELETE'))).status).toBe(200);
    expect((await app.request(`/swdnd/scenes/${id}`)).status).toBe(404);
  });
});
