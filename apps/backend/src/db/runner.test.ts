import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, type Migration } from './runner';

describe('runMigrations', () => {
  it('applies each migration once and is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swdnd-mig-'));
    writeFileSync(join(dir, '001_init.sql'), 'CREATE TABLE t (id INTEGER PRIMARY KEY);');
    const migrations: Migration[] = [{ version: '001_init', file: '001_init.sql' }];
    const db = new Database(':memory:');

    runMigrations(db, migrations, dir);
    db.run('INSERT INTO t (id) VALUES (1)');
    expect(db.query('SELECT version FROM schema_migrations').all()).toEqual([
      { version: '001_init' },
    ]);

    // Second run must not re-apply (table keeps its single row).
    runMigrations(db, migrations, dir);
    expect(db.query('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 1 });
  });
});
