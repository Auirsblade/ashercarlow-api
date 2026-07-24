// apps/backend/src/routes/swdnd/gate.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-gate-${crypto.randomUUID()}.sqlite`);
  process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret'; // production-like
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  // swdndDb is a shared singleton across test files — reset before seeding.
  swdndDb.exec('DELETE FROM encounter; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'Ash', 'tok-1', 'n']);
  swdndDb.run(
    "INSERT INTO character (id,campaign_id,player_id,name,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ['ch1', 'c1', 'p1', 'Lyra', '{"schemaVersion":1}', 'n', 'n'],
  );
});

test('blanket gate still blocks non-admin content mutation', async () => {
  const res = await app.request('/swdnd/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  });
  expect(res.status).toBe(401);
});

test('owning player can PATCH their character with their token', async () => {
  const res = await app.request('/swdnd/characters/ch1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Player-Token': 'tok-1' },
    body: JSON.stringify({ data_json: { schemaVersion: 1, play: { hp: 5 } } }),
  });
  expect(res.status).toBe(200);
});

test('a stranger cannot PATCH the character', async () => {
  const res = await app.request('/swdnd/characters/ch1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Player-Token': 'wrong' },
    body: JSON.stringify({ data_json: { schemaVersion: 1 } }),
  });
  expect(res.status).toBe(403);
});

test('player-slot creation is blocked without admin auth', async () => {
  const res = await app.request('/swdnd/campaigns/c1/players', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mara' }),
  });
  expect(res.status).toBe(403);
});

test('player-slot creation succeeds with the admin bearer token', async () => {
  const res = await app.request('/swdnd/campaigns/c1/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-secret' },
    body: JSON.stringify({ name: 'Mara' }),
  });
  expect(res.status).toBe(201);
});

test('players list GET requires admin (it exposes access tokens; GETs bypass the blanket gate)', async () => {
  const anon = await app.request('/swdnd/campaigns/c1/players');
  expect(anon.status).toBe(403);

  const asPlayer = await app.request('/swdnd/campaigns/c1/players', { headers: { 'X-Player-Token': 'tok-1' } });
  expect(asPlayer.status).toBe(403); // player tokens don't grant admin

  const asAdmin = await app.request('/swdnd/campaigns/c1/players', { headers: { Authorization: 'Bearer admin-secret' } });
  expect(asAdmin.status).toBe(200);
  const rows = await asAdmin.json();
  expect(rows.some((p: { id: string }) => p.id === 'p1')).toBe(true);
});

test('player slot mutations ride the blanket admin gate', async () => {
  const anonPatch = await app.request('/swdnd/players/p1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  });
  expect(anonPatch.status).toBe(401);

  const playerPatch = await app.request('/swdnd/players/p1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Player-Token': 'tok-1' },
    body: JSON.stringify({ name: 'x' }),
  });
  expect(playerPatch.status).toBe(401); // the blanket gate only accepts bearer/cookie

  const anonDelete = await app.request('/swdnd/players/p1', { method: 'DELETE' });
  expect(anonDelete.status).toBe(401);

  const adminPatch = await app.request('/swdnd/players/p1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-secret' },
    body: JSON.stringify({ name: 'Ash Renamed' }),
  });
  expect(adminPatch.status).toBe(200);
});

test('encounter mutations ride the blanket admin gate; reads stay open', async () => {
  const anonPost = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  });
  expect(anonPost.status).toBe(401);

  const playerPost = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Player-Token': 'tok-1' },
    body: JSON.stringify({ name: 'x' }),
  });
  expect(playerPost.status).toBe(401); // gate only accepts bearer/cookie

  const adminPost = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-secret' },
    body: JSON.stringify({ name: 'Gated group' }),
  });
  expect(adminPost.status).toBe(201);
  const enc = await adminPost.json();

  expect((await app.request(`/swdnd/encounters/${enc.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'y' }),
  })).status).toBe(401);
  expect((await app.request(`/swdnd/encounters/${enc.id}`, { method: 'DELETE' })).status).toBe(401);

  const anonList = await app.request('/swdnd/campaigns/c1/encounters');
  expect(anonList.status).toBe(200); // reads open, like campaigns/characters

  // cleanup so this file leaves no encounter state behind
  const del = await app.request(`/swdnd/encounters/${enc.id}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer admin-secret' },
  });
  expect(del.status).toBe(200);
});
