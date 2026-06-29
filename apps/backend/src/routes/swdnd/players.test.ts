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
