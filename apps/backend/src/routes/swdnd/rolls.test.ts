// apps/backend/src/routes/swdnd/rolls.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';

let app: OpenAPIHono;
let swdndDb: import('bun:sqlite').Database;

const ADMIN = { Authorization: 'Bearer admin-secret' };
const JSON_H = { 'Content-Type': 'application/json' };

const post = (campaign: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`/swdnd/campaigns/${campaign}/rolls`, {
    method: 'POST', headers: { ...JSON_H, ...headers }, body: JSON.stringify(body),
  });

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-rolls-${crypto.randomUUID()}.sqlite`);
  process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret'; // production-like
  ({ swdndDb } = await import('../../db/swdnd'));
  const { registerSwdndRoutes } = await import('./index');
  app = new OpenAPIHono();
  registerSwdndRoutes(app);
  swdndDb.exec('DELETE FROM roll; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'Camp', 'n', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'Kira', 'tok-1', 'n']);
});

test('member POST: player token works, roller defaults to the player name', async () => {
  const res = await post('c1', { formula: '2d6+3', rolls: [{ sides: 6, value: 4 }, { sides: 6, value: 2 }], total: 9 }, { 'X-Player-Token': 'tok-1' });
  expect(res.status).toBe(201);
  const roll = await res.json();
  expect(roll.roller).toBe('Kira');
  expect(roll.rolls_json).toEqual([{ sides: 6, value: 4 }, { sides: 6, value: 2 }]);
  expect(roll.hidden).toBe(0);
});

test('explicit roller (sheet rolls send the character name) is kept', async () => {
  const res = await post('c1', { roller: 'Lyra', label: 'Stealth check', formula: '1d20+5', rolls: [{ sides: 20, value: 17 }], total: 22 }, { 'X-Player-Token': 'tok-1' });
  expect(res.status).toBe(201);
  expect((await res.json()).roller).toBe('Lyra');
});

test('admin POST defaults roller to DM; hidden is honored and not listed for players', async () => {
  const res = await post('c1', { formula: '1d20', rolls: [{ sides: 20, value: 3 }], total: 3, hidden: true }, ADMIN);
  expect(res.status).toBe(201);
  const roll = await res.json();
  expect(roll.roller).toBe('DM');
  expect(roll.hidden).toBe(1);

  const asPlayer = await (await app.request('/swdnd/campaigns/c1/rolls', { headers: { 'X-Player-Token': 'tok-1' } })).json();
  expect(asPlayer.some((r: { id: string }) => r.id === roll.id)).toBe(false);

  const asAdmin = await (await app.request('/swdnd/campaigns/c1/rolls', { headers: ADMIN })).json();
  expect(asAdmin.some((r: { id: string }) => r.id === roll.id)).toBe(true);
});

test('a player asking for hidden gets 403', async () => {
  const res = await post('c1', { formula: '1d20', rolls: [{ sides: 20, value: 9 }], total: 9, hidden: true }, { 'X-Player-Token': 'tok-1' });
  expect(res.status).toBe(403);
});

test('non-members are rejected: anon and wrong-campaign tokens 403', async () => {
  expect((await post('c1', { formula: '1d4', rolls: [{ sides: 4, value: 2 }], total: 2 })).status).toBe(403);
  swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c2', 'Other', 'n', 'n']);
  swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p2', 'c2', 'Rex', 'tok-2', 'n']);
  expect((await post('c1', { formula: '1d4', rolls: [{ sides: 4, value: 2 }], total: 2 }, { 'X-Player-Token': 'tok-2' })).status).toBe(403);
});

test('list is newest-first and honors limit', async () => {
  const list = await (await app.request('/swdnd/campaigns/c1/rolls?limit=2', { headers: ADMIN })).json();
  expect(list).toHaveLength(2);
  const all = await (await app.request('/swdnd/campaigns/c1/rolls', { headers: ADMIN })).json();
  // newest-first: the hidden DM roll (3rd insert) precedes the Lyra roll (2nd insert)
  const ids = all.map((r: { roller: string }) => r.roller);
  expect(ids.indexOf('DM')).toBeLessThan(ids.indexOf('Lyra'));
});

test('unknown campaign 404s on both verbs', async () => {
  expect((await app.request('/swdnd/campaigns/nope/rolls')).status).toBe(404);
  expect((await post('nope', { formula: '1d4', rolls: [], total: 0 }, ADMIN)).status).toBe(404);
});
