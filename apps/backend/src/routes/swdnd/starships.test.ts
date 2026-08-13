import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { swdndDb } from '../../db/swdnd';
import { createApiApp } from '../../lib/openapi';
import * as realtime from '../../lib/swdnd-realtime';

// Captured once at module load, before any mock.module() call below can
// overwrite the live bindings -- these are what we restore to afterward so
// the mock doesn't leak into other test files sharing this bun test process.
const realPublishToRoom = realtime.publishToRoom;
const realRoomForCampaign = realtime.roomForCampaign;
const realSetRealtimeServer = realtime.setRealtimeServer;
const realParseEnvelope = realtime.parseEnvelope;
const realSwdndWebsocket = realtime.swdndWebsocket;

function restoreRealtimeModule(): void {
  mock.module('../../lib/swdnd-realtime', () => ({
    publishToRoom: realPublishToRoom,
    roomForCampaign: realRoomForCampaign,
    setRealtimeServer: realSetRealtimeServer,
    parseEnvelope: realParseEnvelope,
    swdndWebsocket: realSwdndWebsocket,
  }));
}

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

  // publishToRoom is a silent no-op under bun test (serverRef stays null until
  // Bun.serve wires it -- see swdnd-realtime.ts), so nothing pins the
  // ship:updated broadcast contract without intercepting it. Only publishToRoom
  // is faked; roomForCampaign and everything else stays real.
  let publishedEnvelopes: Array<{ type: string; room: string; payload?: unknown }> = [];

  beforeAll(async () => {
    mock.module('../../lib/swdnd-realtime', () => ({
      publishToRoom: (room: string, env: { type: string; room: string; payload?: unknown }) => {
        publishedEnvelopes.push(env);
      },
      roomForCampaign: realRoomForCampaign,
      setRealtimeServer: realSetRealtimeServer,
      parseEnvelope: realParseEnvelope,
      swdndWebsocket: realSwdndWebsocket,
    }));

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

  afterAll(() => {
    restoreRealtimeModule();
  });

  beforeEach(() => {
    publishedEnvelopes = [];
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

  it('PATCH broadcasts ship:updated to the campaign room with the exact {shipId, name, play, data_json} payload', async () => {
    const doc = {
      schemaVersion: 1,
      identity: { name: 'Ghost III', sizeId: 'medium', tier: 3 },
      play: { hull: 9, shields: 4, hullDiceSpent: 1, shieldDiceSpent: 0, ammoSpent: {}, conditions: [], systemDamage: 0, notes: 'holed' },
    };
    const res = await app.request(`/swdnd/starships/${shipId}`, json('PATCH', { name: 'Ghost III', data_json: doc }));
    expect(res.status).toBe(200);

    expect(publishedEnvelopes).toHaveLength(1);
    const [env] = publishedEnvelopes;
    expect(env.type).toBe('ship:updated');
    expect(env.room).toBe(`campaign:${campaignId}`);

    const payload = env.payload as Record<string, unknown>;
    // Exact key set -- catches an added/renamed/dropped field (e.g. shipId -> id,
    // or data_json silently disappearing again) even though it wouldn't change length.
    expect(Object.keys(payload).sort()).toEqual(['data_json', 'name', 'play', 'shipId'].sort());
    expect(payload).toEqual({ shipId, name: 'Ghost III', play: doc.play, data_json: doc });
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

describe('swdnd starship crew roster', () => {
  let campaignId: string;
  let tokenA: string;
  let tokenB: string;
  let charA: string;
  let charB: string;
  let shipId: string;

  // Same mock harness as the 'swdnd starship write + delete' describe above
  // (publishToRoom is a silent no-op under bun test until Bun.serve wires a
  // real server, so nothing pins the crew routes' ship:updated broadcast
  // without intercepting it). Installed fresh here rather than shared across
  // describes because that describe's afterAll already tore its instance
  // down before this one runs.
  let publishedEnvelopes: Array<{ type: string; room: string; payload?: unknown }> = [];

  beforeAll(async () => {
    mock.module('../../lib/swdnd-realtime', () => ({
      publishToRoom: (room: string, env: { type: string; room: string; payload?: unknown }) => {
        publishedEnvelopes.push(env);
      },
      roomForCampaign: realRoomForCampaign,
      setRealtimeServer: realSetRealtimeServer,
      parseEnvelope: realParseEnvelope,
      swdndWebsocket: realSwdndWebsocket,
    }));

    delete process.env.ASHERCARLOW_AUTH_TOKEN;
    swdndDb.exec('DELETE FROM starship_crew; DELETE FROM starship; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
    campaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'R' }))).json()) as any).id;
    const pA = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'A' }))).json()) as any;
    const pB = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'B' }))).json()) as any;
    tokenA = pA.access_token;
    tokenB = pB.access_token;
    charA = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenA}`, json('POST', { name: 'Ace' }))).json()) as any).id;
    charB = ((await (await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${tokenB}`, json('POST', { name: 'Bee' }))).json()) as any).id;
    shipId = ((await (await app.request(`/swdnd/campaigns/${campaignId}/starships`,
      json('POST', { name: 'Ghost', crew: { characterId: charA, role: 'pilot' } }))).json()) as any).id;
  });

  afterAll(() => {
    restoreRealtimeModule();
  });

  beforeEach(() => {
    publishedEnvelopes = [];
  });

  it('PUT adds a crew member and is idempotent on repeat', async () => {
    const first = await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: charB, role: 'gunner' }));
    expect(first.status).toBe(200);
    expect(((await first.json()) as any).crew.map((m: any) => `${m.character_name}:${m.role}`).sort())
      .toEqual(['Ace:pilot', 'Bee:gunner']);

    const again = await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: charB, role: 'gunner' }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).crew).toHaveLength(2);
  });

  it('a character may hold several roles on the same ship', async () => {
    const res = await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: charB, role: 'mechanic' }));
    expect(((await res.json()) as any).crew).toHaveLength(3);
  });

  it('DELETE with a role removes just that role; without one removes every role', async () => {
    const one = await app.request(`/swdnd/starships/${shipId}/crew`, json('DELETE', { characterId: charB, role: 'mechanic' }));
    expect(((await one.json()) as any).crew).toHaveLength(2);

    const all = await app.request(`/swdnd/starships/${shipId}/crew`, json('DELETE', { characterId: charB }));
    expect(((await all.json()) as any).crew.map((m: any) => m.character_name)).toEqual(['Ace']);
  });

  it('rejects a character from another campaign and 404s an unknown ship', async () => {
    const other = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'Other' }))).json()) as any).id;
    const outsider = ((await (await app.request(`/swdnd/campaigns/${other}/characters`, json('POST', { name: 'Outsider' }))).json()) as any).id;
    expect((await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: outsider, role: 'pilot' }))).status).toBe(400);
    expect((await app.request('/swdnd/starships/nope/crew', json('PUT', { characterId: charA, role: 'pilot' }))).status).toBe(404);
  });

  it('a successful PUT and a successful crew DELETE each broadcast exactly one ship:updated envelope with the exact {shipId, name, play, data_json} payload', async () => {
    const before = (await (await app.request(`/swdnd/starships/${shipId}`)).json()) as any;

    const put = await app.request(`/swdnd/starships/${shipId}/crew`, json('PUT', { characterId: charB, role: 'coordinator' }));
    expect(put.status).toBe(200);
    expect(publishedEnvelopes).toHaveLength(1);
    const [putEnv] = publishedEnvelopes;
    expect(putEnv.type).toBe('ship:updated');
    expect(putEnv.room).toBe(`campaign:${campaignId}`);
    const putPayload = putEnv.payload as Record<string, unknown>;
    expect(Object.keys(putPayload).sort()).toEqual(['data_json', 'name', 'play', 'shipId'].sort());
    // Crew mutations never touch data_json -- the broadcast doc is the ship's
    // build/play document, untouched, not the crew roster.
    expect(putPayload).toEqual({ shipId, name: before.name, play: before.data_json.play, data_json: before.data_json });

    publishedEnvelopes = [];
    // Deletes exactly the role just added -- nets to a no-op on the roster so
    // downstream tests in this describe see the same crew state as if this
    // test didn't run.
    const del = await app.request(`/swdnd/starships/${shipId}/crew`, json('DELETE', { characterId: charB, role: 'coordinator' }));
    expect(del.status).toBe(200);
    expect(publishedEnvelopes).toHaveLength(1);
    const [delEnv] = publishedEnvelopes;
    expect(delEnv.type).toBe('ship:updated');
    expect(delEnv.room).toBe(`campaign:${campaignId}`);
    const delPayload = delEnv.payload as Record<string, unknown>;
    expect(Object.keys(delPayload).sort()).toEqual(['data_json', 'name', 'play', 'shipId'].sort());
    expect(delPayload).toEqual({ shipId, name: before.name, play: before.data_json.play, data_json: before.data_json });
  });

  it('crew edits the roster; a non-crew player cannot', async () => {
    await withAuthEnv(async () => {
      // Assert non-crew player B is refused FIRST, while B genuinely crews
      // nothing on this ship. (Ordering matters: assertShipWriteAccess grants
      // write access to any player owning ANY character currently on the
      // crew -- per access.ts's documented "crew edits EVERYTHING" rule -- so
      // running A's add of charB before these checks would make B's own
      // token legitimately crew and turn these 403s into 200s.)
      expect((await app.request(`/swdnd/starships/${shipId}/crew`,
        json('PUT', { characterId: charB, role: 'operator' }, { 'X-Player-Token': tokenB }))).status).toBe(403);
      expect((await app.request(`/swdnd/starships/${shipId}/crew`,
        json('DELETE', { characterId: charA }, { 'X-Player-Token': tokenB }))).status).toBe(403);

      const byCrew = await app.request(`/swdnd/starships/${shipId}/crew`,
        json('PUT', { characterId: charB, role: 'technician' }, { 'X-Player-Token': tokenA }));
      expect(byCrew.status).toBe(200);

      // Pin the "crew edits everything" grant semantics the reorder above
      // depends on: now that charB (owned by B) genuinely crews the ship,
      // B's own token has full write access too -- accepted/documented
      // behavior (access.ts's assertShipWriteAccess), not a bug.
      expect((await app.request(`/swdnd/starships/${shipId}/crew`,
        json('PUT', { characterId: charB, role: 'operator' }, { 'X-Player-Token': tokenB }))).status).toBe(200);
    });
    // clean the extra role back off so the cascade test below is unambiguous
    await app.request(`/swdnd/starships/${shipId}/crew`, json('DELETE', { characterId: charB }));
  });

  it('deleting a character cascades its crew rows away and leaves the ship standing', async () => {
    expect((await app.request(`/swdnd/characters/${charA}`, json('DELETE'))).status).toBe(200);
    const ship = (await (await app.request(`/swdnd/starships/${shipId}`)).json()) as any;
    expect(ship.id).toBe(shipId);
    expect(ship.crew).toEqual([]);
  });
});
