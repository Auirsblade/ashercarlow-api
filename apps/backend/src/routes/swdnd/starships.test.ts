import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { swdndDb } from '../../db/swdnd';

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
