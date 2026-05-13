import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = process.env.SWTCW_DB_PATH ?? './data/swtcw.sqlite';

export const db = new Database(DB_PATH, { create: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const MIGRATIONS = [{ version: '001_swtcw', file: '001_swtcw.sql' }] as const;

function runMigrations(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = db
    .query<{ version: string }, [string]>(
      'SELECT version FROM schema_migrations WHERE version = ?',
    );
  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const m of MIGRATIONS) {
    if (applied.get(m.version)) continue;

    const sql = readFileSync(join(import.meta.dir, 'migrations', m.file), 'utf-8');
    db.transaction(() => {
      db.exec(sql);
      insert.run(m.version, new Date().toISOString());
    })();
    console.log(`[db] applied migration ${m.version}`);
  }
}

runMigrations();
