// sw5e content import — pulls the GPL-3.0 Foundry packs from sw5e-foundry/sw5e.
// The content is unofficial Star Wars fan material; keep this app personal /
// non-commercial. See NOTICE and docs Data Model.md.
import { Glob } from 'bun';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { swdndDb } from '../swdnd';
import { PACK_SOURCES, mapFoundryDoc, type RefRow } from './sw5e-map';

const PACKS_DIR = process.env.SW5E_PACKS_DIR ?? 'vendor/sw5e/packs';

function insertRow(table: string, row: RefRow): void {
  const extraKeys = Object.keys(row.extra);
  const cols = ['id', 'name', 'content_source', 'content_type', 'raw_json', ...extraKeys];
  const placeholders = cols.map(() => '?').join(', ');
  const values = [
    row.id,
    row.name,
    row.content_source,
    row.content_type,
    row.raw_json,
    ...extraKeys.map((k) => row.extra[k]),
  ];
  swdndDb
    .prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...values);
}

function commitHash(repoDir: string): string | null {
  try {
    const r = Bun.spawnSync(['git', '-C', repoDir, 'rev-parse', 'HEAD']);
    return r.success ? r.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

function run(): void {
  if (!existsSync(PACKS_DIR)) {
    console.error(`[sw5e-import] packs dir not found: ${PACKS_DIR}`);
    console.error('Clone the source first, e.g.:');
    console.error('  git clone --depth 1 https://github.com/sw5e-foundry/sw5e.git vendor/sw5e');
    console.error('Or set SW5E_PACKS_DIR to an existing packs/ directory.');
    process.exit(1);
  }

  let total = 0;
  swdndDb.transaction(() => {
    for (const source of PACK_SOURCES) {
      const dir = join(PACKS_DIR, source.packDir);
      if (!existsSync(dir)) {
        console.warn(`[sw5e-import] skipping missing pack dir: ${source.packDir}`);
        continue;
      }
      const files = new Glob('**/*.json').scanSync({ cwd: dir, onlyFiles: true });
      for (const rel of files) {
        const doc = JSON.parse(readFileSync(join(dir, rel), 'utf-8'));
        insertRow(source.table, mapFoundryDoc(source, doc));
        total += 1;
      }
    }
    const repoDir = dirname(PACKS_DIR.replace(/\/+$/, ''));
    swdndDb.run(
      `INSERT OR REPLACE INTO data_version (id, source_repo, commit_hash, imported_at)
       VALUES (1, ?, ?, ?)`,
      ['sw5e-foundry/sw5e', commitHash(repoDir), new Date().toISOString()],
    );
  })();

  // Fold the WAL back into the main file so the .sqlite is a single self-contained
  // artifact (the Docker image bakes this file in via a single-file COPY).
  swdndDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  console.log(`[sw5e-import] imported ${total} records into swdnd.sqlite`);
}

run();
