import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { swdndDb } from '../../db/swdnd';
import { createApiApp } from '../../lib/openapi';

beforeAll(() => {
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
});

describe('swdnd starship schema', () => {
  it('migration 006 created both tables with the expected columns', () => {
    const shipCols = swdndDb.query<{ name: string }, []>('PRAGMA table_info(starship)').all().map((c) => c.name);
    expect(shipCols).toEqual(['id', 'campaign_id', 'name', 'data_json', 'created_at', 'updated_at']);
    const crewCols = swdndDb.query<{ name: string }, []>('PRAGMA table_info(starship_crew)').all().map((c) => c.name);
    expect(crewCols).toEqual(['ship_id', 'character_id', 'role']);
  });

  it('registered the migration in schema_migrations', () => {
    const row = swdndDb
      .query<{ version: string }, [string]>('SELECT version FROM schema_migrations WHERE version = ?')
      .get('006_swdnd_starships');
    expect(row?.version).toBe('006_swdnd_starships');
  });

  it('indexes campaign lookups and the crew reverse lookup', () => {
    const names = swdndDb
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all().map((r) => r.name);
    expect(names).toContain('idx_starship_campaign');
    expect(names).toContain('idx_starship_crew_character');
  });
});

afterAll(() => { delete process.env.ASHERCARLOW_AUTH_TOKEN; });

const app = createApiApp();
const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

describe('swdnd starship reads', () => {
  it('lists an empty campaign and 404s an unknown ship', async () => {
    swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    const now = new Date().toISOString();
    swdndDb.run('INSERT INTO campaign (id, name, created_at, updated_at) VALUES (?,?,?,?)', ['c9', 'C', now, now]);

    const list = await app.request('/swdnd/campaigns/c9/starships');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);

    expect((await app.request('/swdnd/starships/nope')).status).toBe(404);
  });

  it('returns a parsed data_json and the crew roster with character names', async () => {
    const now = new Date().toISOString();
    swdndDb.run('INSERT INTO character (id, campaign_id, player_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['chA', 'c9', null, 'Zed', '{}', now, now]);
    swdndDb.run('INSERT INTO starship (id, campaign_id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['sA', 'c9', 'Ghost', JSON.stringify({ schemaVersion: 1, identity: { name: 'Ghost' } }), now, now]);
    swdndDb.run('INSERT INTO starship_crew (ship_id, character_id, role) VALUES (?,?,?)', ['sA', 'chA', 'pilot']);

    const one = await app.request('/swdnd/starships/sA');
    expect(one.status).toBe(200);
    const body = (await one.json()) as any;
    expect(body.data_json.identity.name).toBe('Ghost');
    expect(body.crew).toEqual([{ character_id: 'chA', character_name: 'Zed', role: 'pilot' }]);

    const list = (await (await app.request('/swdnd/campaigns/c9/starships')).json()) as any[];
    expect(list).toHaveLength(1);
    expect(list[0].crew).toHaveLength(1);
  });
});

// Route tests run in dev mode (no ASHERCARLOW_AUTH_TOKEN), where admin checks
// pass for everyone. To exercise the player matrix we temporarily set the env
// var so the asserts actually discriminate (same pattern as tokens.test.ts).
const withAuthEnv = async (fn: () => Promise<void>) => {
  process.env.ASHERCARLOW_AUTH_TOKEN = 'test-admin-secret';
  try { await fn(); } finally { delete process.env.ASHERCARLOW_AUTH_TOKEN; }
};

describe('swdnd starship creation bootstrap', () => {
  let campaignId: string;
  let tokenA: string;
  let tokenB: string;
  let charA: string;
  let charB: string;
  let tokenOther: string;

  beforeAll(async () => {
    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    campaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'Fleet' }))).json()) as any).id;
    const pA = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'A' }))).json()) as any;
    const pB = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'B' }))).json()) as any;
    tokenA = pA.access_token;
    tokenB = pB.access_token;
    charA = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenA}`, json('POST', { name: 'Ace' }))).json()) as any).id;
    charB = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenB}`, json('POST', { name: 'Bee' }))).json()) as any).id;

    // A player token that is real but belongs to a DIFFERENT campaign than
    // `campaignId`, for the wrong-campaign-token creation test below.
    const otherCampaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'Rebel Alliance' }))).json()) as any).id;
    const pOther = (await (await app.request(`/swdnd/campaigns/${otherCampaignId}/players`, json('POST', { name: 'Outsider' }))).json()) as any;
    tokenOther = pOther.access_token;
  });

  it('admin/dev creation may start with an empty roster and seeds the empty build', async () => {
    const res = await app.request(`/swdnd/campaigns/${campaignId}/starships`, json('POST', { name: 'Ghost' }));
    expect(res.status).toBe(201);
    const ship = (await res.json()) as any;
    expect(ship.crew).toEqual([]);
    expect(ship.data_json).toMatchObject({
      schemaVersion: 1,
      identity: { name: 'Ghost', sizeId: '', tier: 0 },
      abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, increases: [] },
      equipment: [], modifications: [], overrides: {}, houseRuled: [],
    });
    expect(ship.data_json.play).toMatchObject({
      hull: 0, shields: 0, hullDiceSpent: 0, shieldDiceSpent: 0,
      ammoSpent: {}, conditions: [], systemDamage: 0, notes: '',
    });
  });

  it('404s an unknown campaign', async () => {
    expect((await app.request('/swdnd/campaigns/nope/starships', json('POST', { name: 'X' }))).status).toBe(404);
  });

  it('player creation requires an initial crew naming an owned character', async () => {
    await withAuthEnv(async () => {
      // no crew at all -> 400
      const bare = await app.request(`/swdnd/campaigns/${campaignId}/starships?token=${tokenA}`, json('POST', { name: 'Solo' }));
      expect(bare.status).toBe(400);

      // someone else's character -> 403
      const stolen = await app.request(`/swdnd/campaigns/${campaignId}/starships?token=${tokenA}`,
        json('POST', { name: 'Solo', crew: { characterId: charB, role: 'pilot' } }));
      expect(stolen.status).toBe(403);

      // own character -> 201 with the crew row inserted in the same transaction
      const ok = await app.request(`/swdnd/campaigns/${campaignId}/starships?token=${tokenA}`,
        json('POST', { name: 'Solo', crew: { characterId: charA, role: 'pilot' } }));
      expect(ok.status).toBe(201);
      const ship = (await ok.json()) as any;
      expect(ship.crew).toEqual([{ character_id: charA, character_name: 'Ace', role: 'pilot' }]);
    });
  });

  it('rejects an anonymous request (no auth header, no player token) with 403', async () => {
    await withAuthEnv(async () => {
      // Guards that starships.ts's `if (... && !isPlayerCreate) assertAdmin(c)`
      // line is actually load-bearing: with no player resolvable, isPlayerCreate
      // is false, so this must fall into assertAdmin and get rejected. Deleting
      // that gate line would turn this into a 201.
      const res = await app.request(`/swdnd/campaigns/${campaignId}/starships`, json('POST', { name: 'Ghost Rider' }));
      expect(res.status).toBe(403);
    });
  });

  it('rejects a player token from a different campaign, via the same admin-only gate as an anonymous request', async () => {
    await withAuthEnv(async () => {
      // tokenOther resolves to a REAL player (unlike the anonymous case above),
      // but that player's campaign_id != campaignId, so isPlayerCreate is still
      // false. The handler has no dedicated "wrong campaign" branch -- it falls
      // through to the same assertAdmin(c) an anonymous caller would hit, and
      // gets the same 403. Pinning this so a future refactor that special-cases
      // "player token present" without checking campaign membership gets caught.
      const res = await app.request(`/swdnd/campaigns/${campaignId}/starships?token=${tokenOther}`,
        json('POST', { name: 'Ghost Rider' }));
      expect(res.status).toBe(403);
    });
  });

  it('rejects an unknown role at validation time', async () => {
    const res = await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Bad', crew: { characterId: charA, role: 'chef' } }));
    expect(res.status).toBe(400);
  });

  it('rejects a crew character from another campaign', async () => {
    const other = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'Other' }))).json()) as any).id;
    const outsider = ((await (await app.request(`/swdnd/campaigns/${other}/characters`, json('POST', { name: 'Outsider' }))).json()) as any).id;
    const res = await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Mixed', crew: { characterId: outsider, role: 'gunner' } }));
    expect(res.status).toBe(400);
  });
});

describe('swdnd starship write + delete', () => {
  let campaignId: string;
  let tokenA: string;
  let tokenB: string;
  let charA: string;
  let shipId: string;

  beforeAll(async () => {
    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    campaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'W' }))).json()) as any).id;
    const pA = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'A' }))).json()) as any;
    const pB = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'B' }))).json()) as any;
    tokenA = pA.access_token;
    tokenB = pB.access_token;
    charA = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenA}`, json('POST', { name: 'Ace' }))).json()) as any).id;
    shipId = ((await (await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Ghost', crew: { characterId: charA, role: 'pilot' } }))).json()) as any).id;
  });

  it('PATCH replaces the whole document and renames', async () => {
    const doc = { schemaVersion: 1, identity: { name: 'Ghost II', sizeId: 'medium', tier: 2 }, play: { hull: 17 } };
    const res = await app.request(`/swdnd/starships/${shipId}`, json('PATCH', { name: 'Ghost II', data_json: doc }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe('Ghost II');
    expect(body.data_json.identity.tier).toBe(2);
    expect(body.crew).toHaveLength(1);
  });

  it('PATCH/DELETE 404 an unknown ship', async () => {
    expect((await app.request('/swdnd/starships/nope', json('PATCH', { name: 'X' }))).status).toBe(404);
    expect((await app.request('/swdnd/starships/nope', json('DELETE'))).status).toBe(404);
  });

  it('access matrix: crew member writes, non-crew player and anon are 403, admin bearer always writes', async () => {
    await withAuthEnv(async () => {
      const crewWrite = await app.request(`/swdnd/starships/${shipId}`,
        json('PATCH', { name: 'Crewed' }, { 'X-Player-Token': tokenA }));
      expect(crewWrite.status).toBe(200);

      expect((await app.request(`/swdnd/starships/${shipId}`,
        json('PATCH', { name: 'Nope' }, { 'X-Player-Token': tokenB }))).status).toBe(403);
      expect((await app.request(`/swdnd/starships/${shipId}`, json('PATCH', { name: 'Nope' }))).status).toBe(403);

      const admin = await app.request(`/swdnd/starships/${shipId}`,
        json('PATCH', { name: 'Admin' }, { Authorization: 'Bearer test-admin-secret' }));
      expect(admin.status).toBe(200);

      expect((await app.request(`/swdnd/starships/${shipId}`,
        json('DELETE', undefined, { 'X-Player-Token': tokenB }))).status).toBe(403);
    });
  });

  it('DELETE removes the ship and cascades its crew rows', async () => {
    const doomed = ((await (await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Doomed', crew: { characterId: charA, role: 'gunner' } }))).json()) as any).id;
    expect((await app.request(`/swdnd/starships/${doomed}`, json('DELETE'))).status).toBe(200);
    expect((await app.request(`/swdnd/starships/${doomed}`)).status).toBe(404);
    const left = swdndDb.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM starship_crew WHERE ship_id = ?').get(doomed);
    expect(left?.n).toBe(0);
  });
});
