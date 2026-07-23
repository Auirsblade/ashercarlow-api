// apps/backend/src/routes/swdnd/scenes.test.ts
process.env.SWDND_UPLOADS_DIR = `${process.env.TMPDIR ?? '/tmp'}/swdnd-test-uploads-${Date.now()}`;
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

describe('scene image upload', () => {
  let sceneId: string;
  beforeAll(async () => {
    const res = await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'Uploads' }));
    sceneId = ((await res.json()) as any).id;
  });

  const upload = (name: string, type: string, bytes: number, w = 800, h = 600) => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(bytes)], name, { type }));
    fd.append('w', String(w));
    fd.append('h', String(h));
    return app.request(`/swdnd/scenes/${sceneId}/image`, { method: 'POST', body: fd });
  };

  it('accepts a png, stores dimensions, serves it back', async () => {
    const res = await upload('map.png', 'image/png', 1024);
    expect(res.status).toBe(200);
    const s = (await res.json()) as any;
    expect(s.image_path).toBe(`${sceneId}.png`);
    expect(s.image_w).toBe(800);
    expect(s.image_h).toBe(600);
    const img = await app.request(`/swdnd/uploads/${sceneId}.png`);
    expect(img.status).toBe(200);
    expect((await img.arrayBuffer()).byteLength).toBe(1024);
  });

  it('re-uploading with a different extension replaces the old file', async () => {
    const first = await upload('map.png', 'image/png', 1024);
    expect(first.status).toBe(200);
    const pngPath = `${process.env.SWDND_UPLOADS_DIR}/${sceneId}.png`;
    expect(await Bun.file(pngPath).exists()).toBe(true);

    const second = await upload('map.webp', 'image/webp', 2048);
    expect(second.status).toBe(200);
    const s = (await second.json()) as any;
    expect(s.image_path).toBe(`${sceneId}.webp`);

    const webpPath = `${process.env.SWDND_UPLOADS_DIR}/${sceneId}.webp`;
    expect(await Bun.file(webpPath).exists()).toBe(true);
    expect(await Bun.file(pngPath).exists()).toBe(false);
  });

  it('rejects wrong mime and oversize files', async () => {
    expect((await upload('map.gif', 'image/gif', 10)).status).toBe(400);
    expect((await upload('big.png', 'image/png', 10 * 1024 * 1024 + 1)).status).toBe(400);
  });

  it('serves 404 for unknown or hostile filenames', async () => {
    expect((await app.request('/swdnd/uploads/nope.png')).status).toBe(404);
    expect((await app.request('/swdnd/uploads/..%2Fswdnd.sqlite')).status).toBe(404);
  });
});
