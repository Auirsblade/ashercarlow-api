// apps/backend/src/routes/swdnd/encounters.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-encounters-${crypto.randomUUID()}.sqlite`);
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  // Shared singleton — reset in FK order (encounter references campaign).
  swdndDb.exec('DELETE FROM encounter; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
});

test('create, list, patch, delete an encounter', async () => {
  const created = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Droid patrol', monsters: [{ monsterId: 'm1', count: 3 }] }),
  });
  expect(created.status).toBe(201);
  const enc = await created.json();
  expect(enc.name).toBe('Droid patrol');
  expect(enc.monsters_json).toEqual([{ monsterId: 'm1', count: 3 }]);

  const list = await app.request('/swdnd/campaigns/c1/encounters');
  expect(list.status).toBe(200);
  const rows = await list.json();
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(enc.id);

  const patched = await app.request(`/swdnd/encounters/${enc.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Droid ambush', monsters: [{ monsterId: 'm1', count: 2 }, { monsterId: 'm2', count: 1 }] }),
  });
  expect(patched.status).toBe(200);
  const p = await patched.json();
  expect(p.name).toBe('Droid ambush');
  expect(p.monsters_json).toHaveLength(2);

  const deleted = await app.request(`/swdnd/encounters/${enc.id}`, { method: 'DELETE' });
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({ ok: true });
  const after = await app.request('/swdnd/campaigns/c1/encounters');
  expect(await after.json()).toEqual([]);
});

test('unknown campaign / encounter 404', async () => {
  expect((await app.request('/swdnd/campaigns/nope/encounters')).status).toBe(404);
  expect((await app.request('/swdnd/campaigns/nope/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  })).status).toBe(404);
  expect((await app.request('/swdnd/encounters/nope', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
  })).status).toBe(404);
  expect((await app.request('/swdnd/encounters/nope', { method: 'DELETE' })).status).toBe(404);
});

test('monsters validation rejects count < 1', async () => {
  const res = await app.request('/swdnd/campaigns/c1/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'bad', monsters: [{ monsterId: 'm1', count: 0 }] }),
  });
  expect(res.status).toBe(400);
});

test('campaign delete cascades its encounters', async () => {
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c2', 'Doomed', 'n', 'n']);
  await app.request('/swdnd/campaigns/c2/encounters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'orphan?' }),
  });
  swdndDb.run('DELETE FROM campaign WHERE id = ?', ['c2']);
  const left = swdndDb.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM encounter WHERE campaign_id = ?').get('c2');
  expect(left?.n).toBe(0);
});
