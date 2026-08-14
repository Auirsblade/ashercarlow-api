import type { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { REFERENCE_TABLES } from './reference';

/**
 * Content tables owned by the sw5e reference import. Safe to replace wholesale:
 * the user tables (campaign/player/character) only reference each other, never these,
 * so no cascade can touch saved data. `data_version` rides along so the seed's pinned
 * commit is recorded on the live DB.
 */
const CONTENT_TABLES = [...REFERENCE_TABLES.map((t) => t.table), 'data_version'];

/** Column names of a table in the given schema (`main` or the attached `seed`). */
function columnNames(db: Database, schema: string, table: string): string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA ${schema}.table_info(${table})`)
    .all()
    .map((r) => r.name);
}

/**
 * True when the seed has rows for a content table the live DB has none of.
 * A volume seeded before a new reference table existed still reports the same
 * `commit_hash` as the seed, so the version check alone would leave that table
 * empty forever (this is how `starships` reaches already-deployed instances).
 * Tables missing from either side are skipped, matching the copy loop.
 */
function backfillNeeded(db: Database): boolean {
  for (const table of CONTENT_TABLES) {
    if (table === 'data_version') continue;
    if (columnNames(db, 'seed', table).length === 0) continue;
    if (columnNames(db, 'main', table).length === 0) continue;
    const seedRows = db.query<{ n: number }, []>(`SELECT count(*) n FROM seed.${table}`).get()?.n ?? 0;
    if (seedRows === 0) continue;
    const liveRows = db.query<{ n: number }, []>(`SELECT count(*) n FROM main.${table}`).get()?.n ?? 0;
    if (liveRows === 0) return true;
  }
  return false;
}

/**
 * Merge the baked-in sw5e reference content (see Dockerfile) into a live database.
 *
 * Opt-in via `SWDND_SEED_PATH`, which the Docker image sets and local dev leaves unset
 * (local dev populates content with the one-shot `sw5e-import.ts`). Idempotent: seeds
 * only when the live DB has no content yet or the seed's pinned sw5e commit differs from
 * what was last seeded, so restarts of the same image are no-ops and a new image refreshes
 * content without disturbing user data.
 */
export function seedContentFromImage(
  db: Database,
  seedPath = process.env.SWDND_SEED_PATH,
): void {
  if (!seedPath) return;
  if (!existsSync(seedPath)) {
    console.warn(`[swdnd] seed db not found at ${seedPath}; skipping content seed`);
    return;
  }

  db.prepare('ATTACH DATABASE ? AS seed').run(seedPath);
  try {
    const seedVersion = db
      .query<{ commit_hash: string | null }, []>(
        'SELECT commit_hash FROM seed.data_version WHERE id = 1',
      )
      .get();
    const liveVersion = db
      .query<{ commit_hash: string | null }, []>(
        'SELECT commit_hash FROM main.data_version WHERE id = 1',
      )
      .get();

    if (
      liveVersion && seedVersion
      && liveVersion.commit_hash === seedVersion.commit_hash
      && !backfillNeeded(db)
    ) {
      return; // content already matches the baked-in seed
    }

    db.transaction(() => {
      for (const table of CONTENT_TABLES) {
        // Copy only columns present in BOTH databases, by name. A long-lived volume can
        // carry legacy columns the current seed no longer has (e.g. classes/archetypes
        // once had caster_type/caster_ratio), so a positional `SELECT *` would supply the
        // wrong number of values. Matching by name tolerates drift in either direction.
        const seedCols = columnNames(db, 'seed', table);
        const liveCols = new Set(columnNames(db, 'main', table));
        const shared = seedCols.filter((c) => liveCols.has(c));
        if (shared.length === 0) continue;
        const cols = shared.map((c) => `"${c}"`).join(', ');
        db.exec(
          `INSERT OR REPLACE INTO main.${table} (${cols}) SELECT ${cols} FROM seed.${table}`,
        );
      }
    })();

    console.log(
      `[swdnd] seeded reference content (${seedVersion?.commit_hash ?? 'unknown'})`,
    );
  } finally {
    db.exec('DETACH DATABASE seed');
  }
}
