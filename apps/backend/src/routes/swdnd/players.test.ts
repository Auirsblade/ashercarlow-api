// apps/backend/src/routes/swdnd/players.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-players-${crypto.randomUUID()}.sqlite`);
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  // swdndDb is a shared singleton across test files — reset before seeding.
  swdndDb.exec('DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
});

test('create a player slot then resolve it by token', async () => {
  const created = await app.request('/swdnd/campaigns/c1/players', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ash' }),
  });
  expect(created.status).toBe(201);
  const player = await created.json();
  expect(player.name).toBe('Ash');
  expect(typeof player.access_token).toBe('string');

  const me = await app.request(`/swdnd/players/me?token=${player.access_token}`);
  expect(me.status).toBe(200);
  const body = await me.json();
  expect(body.player.id).toBe(player.id);
  expect(body.characters).toEqual([]);
});

test('unknown token 404s', async () => {
  const res = await app.request('/swdnd/players/me?token=nope');
  expect(res.status).toBe(404);
});

test('list players in a campaign (admin; dev mode passes)', async () => {
  const created = await app.request('/swdnd/campaigns/c1/players', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rook' }),
  });
  const rook = await created.json();

  const res = await app.request('/swdnd/campaigns/c1/players');
  expect(res.status).toBe(200);
  const rows = await res.json();
  expect(rows.some((p: { id: string; access_token: string }) => p.id === rook.id && p.access_token === rook.access_token)).toBe(true);

  const missing = await app.request('/swdnd/campaigns/nope/players');
  expect(missing.status).toBe(404);
});

test('rename a player slot', async () => {
  const created = await app.request('/swdnd/campaigns/c1/players', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Old Name' }),
  });
  const player = await created.json();

  const res = await app.request(`/swdnd/players/${player.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New Name' }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.name).toBe('New Name');
  expect(body.access_token).toBe(player.access_token); // token unchanged by rename

  const missing = await app.request('/swdnd/players/nope', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  });
  expect(missing.status).toBe(404);
});

test('delete a player slot keeps its characters, ownerless', async () => {
  const created = await app.request('/swdnd/campaigns/c1/players', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Doomed' }),
  });
  const player = await created.json();
  swdndDb.run(
    'INSERT INTO character (id,campaign_id,player_id,name,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ['orphan-ch', 'c1', player.id, 'Orphan', '{"schemaVersion":1}', 'n', 'n'],
  );

  const res = await app.request(`/swdnd/players/${player.id}`, { method: 'DELETE' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const owner = swdndDb
    .query<{ player_id: string | null }, [string]>('SELECT player_id FROM character WHERE id = ?')
    .get('orphan-ch');
  expect(owner?.player_id).toBeNull();

  const me = await app.request(`/swdnd/players/me?token=${player.access_token}`);
  expect(me.status).toBe(404); // token dead

  const missing = await app.request('/swdnd/players/nope', { method: 'DELETE' });
  expect(missing.status).toBe(404);
});
