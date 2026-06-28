import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Migration {
  version: string;
  file: string;
}

/** Open a SQLite database with the project defaults (WAL + foreign keys). */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Apply any not-yet-applied migrations, tracked in schema_migrations. */
export function runMigrations(
  db: Database,
  migrations: Migration[],
  migrationsDir: string,
): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = db.query<{ version: string }, [string]>(
    'SELECT version FROM schema_migrations WHERE version = ?',
  );
  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const m of migrations) {
    if (applied.get(m.version)) continue;
    const sql = readFileSync(join(migrationsDir, m.file), 'utf-8');
    db.transaction(() => {
      db.exec(sql);
      insert.run(m.version, new Date().toISOString());
    })();
    console.log(`[db] applied migration ${m.version}`);
  }
}
