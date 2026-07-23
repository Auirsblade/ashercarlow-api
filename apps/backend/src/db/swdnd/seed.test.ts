import { describe, it, expect, afterAll } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from '../runner';
import { ensureReferenceTables } from './reference';
import { seedContentFromImage } from './seed';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'migrations', 'swdnd');
const CORE = [{ version: '001_swdnd_core', file: '001_swdnd_core.sql' }];

/** Build a DB with the production schema (migrations + reference tables). */
function makeDb(path: string): Database {
  const db = openDatabase(path);
  runMigrations(db, CORE, MIGRATIONS_DIR);
  ensureReferenceTables(db);
  return db;
}

/** Write a self-contained seed DB: given species rows + a data_version commit. */
function writeSeed(path: string, commit: string, speciesIds: string[]): void {
  const db = makeDb(path);
  for (const id of speciesIds) {
    db.prepare(
      "INSERT OR REPLACE INTO species (id, name, content_source, content_type, raw_json) VALUES (?, ?, NULL, NULL, '{}')",
    ).run(id, id);
  }
  db.prepare(
    'INSERT OR REPLACE INTO data_version (id, source_repo, commit_hash, imported_at) VALUES (1, ?, ?, ?)',
  ).run('sw5e-foundry/sw5e', commit, new Date().toISOString());
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

function speciesCount(db: Database): number {
  return db.query<{ n: number }, []>('SELECT count(*) n FROM species').get()!.n;
}

function liveCommit(db: Database): string | null {
  return (
    db
      .query<{ commit_hash: string | null }, []>(
        'SELECT commit_hash FROM data_version WHERE id = 1',
      )
      .get()?.commit_hash ?? null
  );
}

describe('seedContentFromImage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'swdnd-seed-'));
  const seedPath = join(dir, 'seed.sqlite');
  const livePath = join(dir, 'live.sqlite');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('seeds empty content, refreshes on a new commit while preserving user data, then no-ops', () => {
    writeSeed(seedPath, 'aaa', ['wookiee']);
    const live = makeDb(livePath);

    // 1. Empty live DB gets seeded.
    seedContentFromImage(live, seedPath);
    expect(speciesCount(live)).toBe(1);
    expect(liveCommit(live)).toBe('aaa');

    // 2. A player creates real data.
    live
      .prepare(
        "INSERT INTO campaign (id, name, created_at, updated_at) VALUES ('c1', 'Camp', 't', 't')",
      )
      .run();
    live
      .prepare(
        "INSERT INTO character (id, campaign_id, name, created_at, updated_at) VALUES ('ch1', 'c1', 'Ahsoka', 't', 't')",
      )
      .run();

    // 3. A newer seed (different commit, extra content) refreshes content...
    writeSeed(seedPath, 'bbb', ['wookiee', 'twilek']);
    seedContentFromImage(live, seedPath);
    expect(speciesCount(live)).toBe(2);
    expect(liveCommit(live)).toBe('bbb');
    // ...and leaves the saved character untouched.
    expect(
      live.query<{ n: number }, []>("SELECT count(*) n FROM character WHERE id = 'ch1'").get()!
        .n,
    ).toBe(1);

    // 4. Re-running against the same commit is a no-op.
    seedContentFromImage(live, seedPath);
    expect(speciesCount(live)).toBe(2);

    live.close();
  });

  it('does nothing when no seed path is configured', () => {
    const live = makeDb(join(dir, 'nopath.sqlite'));
    seedContentFromImage(live, undefined);
    expect(speciesCount(live)).toBe(0);
    live.close();
  });

  it('warns and skips when the seed path does not exist', () => {
    const live = makeDb(join(dir, 'missing.sqlite'));
    seedContentFromImage(live, join(dir, 'does-not-exist.sqlite'));
    expect(speciesCount(live)).toBe(0);
    live.close();
  });
});
