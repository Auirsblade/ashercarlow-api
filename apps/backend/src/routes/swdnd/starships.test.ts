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
