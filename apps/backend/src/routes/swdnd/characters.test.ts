// apps/backend/src/routes/swdnd/characters.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-char-${crypto.randomUUID()}.sqlite`);
  delete process.env.ASHERCARLOW_AUTH_TOKEN; // dev mode: writes open
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
});

test('create → get → list → patch → delete', async () => {
  const created = await app.request('/swdnd/campaigns/c1/characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Lyra' }),
  });
  expect(created.status).toBe(201);
  const char = await created.json();
  expect(char.name).toBe('Lyra');
  expect(char.data_json.schemaVersion).toBe(1); // parsed, not a string

  const got = await app.request(`/swdnd/characters/${char.id}`);
  expect(got.status).toBe(200);

  const list = await app.request('/swdnd/campaigns/c1/characters');
  expect((await list.json())).toHaveLength(1);

  const patched = await app.request(`/swdnd/characters/${char.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Lyra Voss', data_json: { schemaVersion: 1, play: { hp: 12 } } }),
  });
  expect(patched.status).toBe(200);
  expect((await patched.json()).data_json.play.hp).toBe(12);

  const del = await app.request(`/swdnd/characters/${char.id}`, { method: 'DELETE' });
  expect(del.status).toBe(200);
  const after = await app.request(`/swdnd/characters/${char.id}`);
  expect(after.status).toBe(404);
});

test('creating in a missing campaign 404s', async () => {
  const res = await app.request('/swdnd/campaigns/nope/characters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  });
  expect(res.status).toBe(404);
});
