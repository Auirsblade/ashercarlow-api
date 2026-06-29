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
  swdndDb.exec('DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
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
