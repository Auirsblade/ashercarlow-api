// apps/backend/src/routes/swdnd/tokens-image.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;
let uploads: string;

const ADMIN = { Authorization: 'Bearer admin-secret' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Bun's app.request() infers a multipart part's MIME type from the filename
// extension rather than the Blob's explicit `type`, so the filename must vary
// with `type` for the "wrong mime" case to actually reach the server as such
// (same reason scenes.test.ts's upload() varies filename per mime, e.g. map.gif).
const EXT_FOR_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const upload = (tokenId: string, headers: Record<string, string> = {}, type = 'image/png') => {
  const fd = new FormData();
  fd.append('file', new File([PNG], `face.${EXT_FOR_MIME[type] ?? 'bin'}`, { type }));
  return app.request(`/swdnd/tokens/${tokenId}/image`, { method: 'POST', headers, body: fd });
};

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-tokimg-${crypto.randomUUID()}.sqlite`);
  process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
  uploads = mkdtempSync(join(tmpdir(), 'swdnd-uploads-'));
  process.env.SWDND_UPLOADS_DIR = uploads;
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  swdndDb.exec('DELETE FROM token; DELETE FROM scene; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'Kira', 'tok-1', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p2', 'c1', 'Rex', 'tok-2', 'n']);
  swdndDb.run(
    "INSERT INTO character (id,campaign_id,player_id,name,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ['ch1', 'c1', 'p1', 'Lyra', '{"schemaVersion":1}', 'n', 'n'],
  );
  swdndDb.run(
    "INSERT INTO scene (id,campaign_id,name,grid_json,fog_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ['s1', 'c1', 'Map', '{}', '[]', 'n', 'n'],
  );
  swdndDb.run(
    "INSERT INTO token (id,scene_id,character_id,name,color,faction,q,r,conditions_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ['t-own', 's1', 'ch1', 'Lyra', '#4dd0e1', 'friendly', 0, 0, '[]', 'n', 'n'],
  );
  swdndDb.run(
    "INSERT INTO token (id,scene_id,character_id,name,color,faction,q,r,conditions_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ['t-npc', 's1', null, 'Droid', '#ff5470', 'hostile', 1, 0, '[]', 'n', 'n'],
  );
});

test('admin can set any token image; file lands and is served', async () => {
  const res = await upload('t-npc', ADMIN);
  expect(res.status).toBe(200);
  const tok = await res.json();
  expect(tok.image_path).toBe('token-t-npc.png');
  const served = await app.request(`/swdnd/uploads/${tok.image_path}`);
  expect(served.status).toBe(200);
});

test('owning player can set their own character token image', async () => {
  const res = await upload('t-own', { 'X-Player-Token': 'tok-1' });
  expect(res.status).toBe(200);
  expect((await res.json()).image_path).toBe('token-t-own.png');
});

test('anon and non-owning players are rejected', async () => {
  expect((await upload('t-own')).status).toBe(403);
  expect((await upload('t-own', { 'X-Player-Token': 'tok-2' })).status).toBe(403);
  expect((await upload('t-npc', { 'X-Player-Token': 'tok-1' })).status).toBe(403); // NPC token has no owner
});

test('bad uploads 400: wrong mime, missing file', async () => {
  expect((await upload('t-npc', ADMIN, 'image/gif')).status).toBe(400);
  const empty = new FormData();
  const res = await app.request('/swdnd/tokens/t-npc/image', { method: 'POST', headers: ADMIN, body: empty });
  expect(res.status).toBe(400);
});

test('delete clears image_path (same access rule) and 404s on unknown token', async () => {
  expect((await app.request('/swdnd/tokens/t-own/image', { method: 'DELETE', headers: { 'X-Player-Token': 'tok-2' } })).status).toBe(403);
  const res = await app.request('/swdnd/tokens/t-own/image', { method: 'DELETE', headers: { 'X-Player-Token': 'tok-1' } });
  expect(res.status).toBe(200);
  expect((await res.json()).image_path).toBeNull();
  expect((await app.request('/swdnd/tokens/nope/image', { method: 'DELETE', headers: ADMIN })).status).toBe(404);
});
