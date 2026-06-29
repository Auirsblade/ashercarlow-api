import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureReferenceTables, REFERENCE_TABLES } from './reference';

describe('ensureReferenceTables', () => {
  it('creates every manifest table with the common columns and is idempotent', () => {
    const db = new Database(':memory:');
    ensureReferenceTables(db);
    ensureReferenceTables(db); // idempotent

    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table'",
      )
      .all()
      .map((r) => r.name);

    for (const t of REFERENCE_TABLES) {
      expect(names).toContain(t.table);
    }

    const cols = db
      .query<{ name: string }, []>('PRAGMA table_info(species)')
      .all()
      .map((r) => r.name);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'name', 'content_source', 'content_type', 'raw_json']),
    );

    const classCols = db
      .query<{ name: string }, []>('PRAGMA table_info(classes)')
      .all()
      .map((r) => r.name);
    expect(classCols).toContain('caster_ratio');
  });
});
