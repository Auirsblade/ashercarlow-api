// apps/backend/src/routes/swdnd/access.test.ts
import { test, expect, afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
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

describe('canJoinCampaignRoom', () => {
  const CAMP = 'camp-ws';
  beforeAll(() => {
    const now = new Date().toISOString();
    dbMod.swdndDb.run('INSERT OR REPLACE INTO campaign (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [CAMP, 'WS', now, now]);
    dbMod.swdndDb.run('INSERT OR REPLACE INTO player (id, campaign_id, name, access_token, created_at) VALUES (?, ?, ?, ?, ?)', ['pl-ws', CAMP, 'P', 'ws-token', now]);
  });
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it('dev mode (no env token) admits anyone', () => {
    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    expect(mod.canJoinCampaignRoom(req('http://x/swdnd/ws?campaign=' + CAMP), CAMP)).toBe(true);
  });

  it('with auth on: valid player token for THAT campaign only', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    try {
      expect(mod.canJoinCampaignRoom(req(`http://x/swdnd/ws?campaign=${CAMP}&token=ws-token`), CAMP)).toBe(true);
      expect(mod.canJoinCampaignRoom(req(`http://x/swdnd/ws?campaign=other&token=ws-token`), 'other')).toBe(false);
      expect(mod.canJoinCampaignRoom(req(`http://x/swdnd/ws?campaign=${CAMP}&token=wrong`), CAMP)).toBe(false);
      expect(mod.canJoinCampaignRoom(req(`http://x/swdnd/ws?campaign=${CAMP}`), CAMP)).toBe(false);
    } finally { delete process.env.ASHERCARLOW_AUTH_TOKEN; }
  });

  it('with auth on: admin cookie or bearer admits', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    try {
      expect(mod.canJoinCampaignRoom(req(`http://x/swdnd/ws?campaign=${CAMP}`, { cookie: 'ashercarlow_auth=admin-secret' }), CAMP)).toBe(true);
      expect(mod.canJoinCampaignRoom(req(`http://x/swdnd/ws?campaign=${CAMP}`, { authorization: 'Bearer admin-secret' }), CAMP)).toBe(true);
      expect(mod.canJoinCampaignRoom(req(`http://x/swdnd/ws?campaign=${CAMP}`, { cookie: 'ashercarlow_auth=nope' }), CAMP)).toBe(false);
    } finally { delete process.env.ASHERCARLOW_AUTH_TOKEN; }
  });
});

// Append at the END of the file: this beforeEach clears the file-level seed
// (campaign c1 / player p1) that the earlier tests in this file rely on.
describe('assertShipWriteAccess', () => {
  const shipReq = (headers: Record<string, string> = {}) =>
    reqWith(headers, 'http://x/swdnd/starships/s1');

  beforeEach(() => {
    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    dbMod.swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    const now = new Date().toISOString();
    dbMod.swdndDb.run('INSERT INTO campaign (id, name, created_at, updated_at) VALUES (?,?,?,?)', ['c1', 'C', now, now]);
    dbMod.swdndDb.run('INSERT INTO player (id, campaign_id, name, access_token, created_at) VALUES (?,?,?,?,?)', ['p1', 'c1', 'P1', 'tok-1', now]);
    dbMod.swdndDb.run('INSERT INTO player (id, campaign_id, name, access_token, created_at) VALUES (?,?,?,?,?)', ['p2', 'c1', 'P2', 'tok-2', now]);
    dbMod.swdndDb.run('INSERT INTO character (id, campaign_id, player_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['ch1', 'c1', 'p1', 'Hero', '{}', now, now]);
    dbMod.swdndDb.run('INSERT INTO character (id, campaign_id, player_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['ch2', 'c1', 'p2', 'Other', '{}', now, now]);
    dbMod.swdndDb.run('INSERT INTO starship (id, campaign_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['s1', 'c1', 'Ghost', '{}', now, now]);
    dbMod.swdndDb.run('INSERT INTO starship_crew (ship_id, character_id, role) VALUES (?,?,?)', ['s1', 'ch1', 'pilot']);
  });

  it('passes for everyone in dev mode (no admin token configured)', () => {
    expect(() => mod.assertShipWriteAccess(shipReq(), 's1')).not.toThrow();
  });

  it('passes for the admin bearer token', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    expect(() => mod.assertShipWriteAccess(shipReq({ authorization: 'Bearer admin-secret' }), 's1')).not.toThrow();
  });

  it('passes for a player owning a character on the crew', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    expect(() => mod.assertShipWriteAccess(shipReq({ 'x-player-token': 'tok-1' }), 's1')).not.toThrow();
  });

  it('throws 403 for a player whose characters are not on the crew', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    let caught: unknown;
    try {
      mod.assertShipWriteAccess(shipReq({ 'x-player-token': 'tok-2' }), 's1');
    } catch (err) {
      caught = err;
    }
    expect((caught as { status?: number } | undefined)?.status).toBe(403);
  });

  it('throws 403 with no token at all', () => {
    process.env.ASHERCARLOW_AUTH_TOKEN = 'admin-secret';
    let caught: unknown;
    try {
      mod.assertShipWriteAccess(shipReq(), 's1');
    } catch (err) {
      caught = err;
    }
    expect((caught as { status?: number } | undefined)?.status).toBe(403);
  });

  it('playerCrewsShip returns true for crew member, false otherwise', () => {
    expect(mod.playerCrewsShip('p1', 's1')).toBe(true);
    expect(mod.playerCrewsShip('p2', 's1')).toBe(false);
    expect(mod.playerCrewsShip('p1', 'nope')).toBe(false);
  });
});

afterAll(() => { delete process.env.ASHERCARLOW_AUTH_TOKEN; });
