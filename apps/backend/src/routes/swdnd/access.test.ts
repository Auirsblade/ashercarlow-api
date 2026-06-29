// apps/backend/src/routes/swdnd/access.test.ts
import { test, expect, beforeAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let mod: typeof import('./access');
let dbMod: typeof import('../../db/swdnd');

beforeAll(async () => {
  process.env.SWDND_DB_PATH = join(tmpdir(), `swdnd-access-${crypto.randomUUID()}.sqlite`);
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
  dbMod = await import('../../db/swdnd');
  mod = await import('./access');
  // The swdndDb singleton is shared across test files in one bun process, so
  // clear it before seeding to stay isolated regardless of file run order.
  dbMod.swdndDb.exec('DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  // seed a campaign + player
  dbMod.swdndDb.run('INSERT INTO campaign (id,name,created_at,updated_at) VALUES (?,?,?,?)', ['c1', 'C', 'n', 'n']);
  dbMod.swdndDb.run('INSERT INTO player (id,campaign_id,name,access_token,created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'Ash', 'tok-1', 'n']);
});

function reqWith(headers: Record<string, string>, url = 'http://x/swdnd/characters/x') {
  return { req: { header: (k: string) => headers[k.toLowerCase()], url, method: 'PATCH', raw: { headers: new Headers(headers) } } } as any;
}

test('resolvePlayerByToken finds the owning player', () => {
  expect(mod.resolvePlayerByToken('tok-1')?.id).toBe('p1');
  expect(mod.resolvePlayerByToken('nope')).toBeNull();
});

test('dev mode (no admin token) allows any write', () => {
  expect(() => mod.assertCharacterWriteAccess(reqWith({}), { player_id: 'p1' })).not.toThrow();
});

test('with admin token set, owning player token passes; wrong token 403s', () => {
  process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
  expect(() => mod.assertCharacterWriteAccess(reqWith({ 'x-player-token': 'tok-1' }), { player_id: 'p1' })).not.toThrow();
  expect(() => mod.assertCharacterWriteAccess(reqWith({ 'x-player-token': 'tok-1' }), { player_id: 'other' })).toThrow();
  expect(() => mod.assertCharacterWriteAccess(reqWith({ authorization: 'Bearer admin-secret' }), { player_id: 'p1' })).not.toThrow();
  expect(() => mod.assertCharacterWriteAccess(reqWith({}), { player_id: 'p1' })).toThrow();
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
});
