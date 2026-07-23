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

    if (liveVersion && seedVersion && liveVersion.commit_hash === seedVersion.commit_hash) {
      return; // content already matches the baked-in seed
    }

    db.transaction(() => {
      for (const table of CONTENT_TABLES) {
        db.exec(`INSERT OR REPLACE INTO main.${table} SELECT * FROM seed.${table}`);
      }
    })();

    console.log(
      `[swdnd] seeded reference content (${seedVersion?.commit_hash ?? 'unknown'})`,
    );
  } finally {
    db.exec('DETACH DATABASE seed');
  }
}
