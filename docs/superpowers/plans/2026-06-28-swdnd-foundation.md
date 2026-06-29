# swdnd Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `swdnd` module — a runnable React app shell on swdnd.ashercarlow.com, a `/swdnd/*` API + Bun WebSocket backbone, a separate `swdnd.sqlite` populated with sw5e reference data, and Docker wiring — so the three features can be built on top later.

**Architecture:** New `apps/swdnd` React+Vite+Tailwind SPA served by the existing single Bun+Hono process via Host dispatch. Backend gains `/swdnd/*` OpenAPI routes (auth-gated like `swtcw`), a Bun-native WebSocket endpoint (`/swdnd/ws`, room = campaign), and a second SQLite database via a refactored shared migration runner. sw5e content is ingested from the GPL-3.0 Foundry `sw5e-foundry/sw5e` packs by a one-shot, manifest-driven import script.

**Tech Stack:** Bun, Hono + `@hono/zod-openapi`, `bun:sqlite`, Bun WebSockets, React 19 + React Router 7, Vite 7, Tailwind v4. Tests: `bun test`.

**Spec:** `docs/superpowers/specs/2026-06-28-swdnd-foundation-design.md`. Vault docs: `Mount Tantiss/ashercarlow.com/swdnd/`.

---

## File Map

**Backend (create):**
- `apps/backend/src/db/runner.ts` — reusable `openDatabase` + `runMigrations`
- `apps/backend/src/db/swdnd/index.ts` — `swdndDb` (opens DB, runs migrations, ensures reference tables)
- `apps/backend/src/db/swdnd/reference.ts` — reference-table manifest + `ensureReferenceTables`
- `apps/backend/src/db/migrations/swdnd/001_swdnd_core.sql` — campaign/player/character/data_version
- `apps/backend/src/db/import/sw5e-map.ts` — pure pack→row mapping
- `apps/backend/src/db/import/sw5e-import.ts` — one-shot import script
- `apps/backend/src/lib/swdnd-realtime.ts` — WS envelope, room helpers, handler, publish
- `apps/backend/src/routes/swdnd/index.ts` — auth gate + `registerSwdndRoutes`
- `apps/backend/src/routes/swdnd/content.ts` — reference content read routes
- `apps/backend/src/routes/swdnd/campaigns.ts` — campaign CRUD + WS broadcast
- Tests: `runner.test.ts`, `db/import/sw5e-map.test.ts`, `lib/swdnd-realtime.test.ts`

**Backend (modify):**
- `apps/backend/src/db/index.ts` — use the shared runner, keep `export const db`
- `apps/backend/src/lib/openapi.ts` — register swdnd routes
- `apps/backend/src/middleware/cors.ts` — allow swdnd host
- `apps/backend/src/index.ts` — host case, SWDND_DIST, WS upgrade + handler

**Frontend (create):** full `apps/swdnd/` (config + `src/`).

**Root / infra (modify):** `package.json` (build scripts), `Dockerfile`, `docker-compose.yml`, `.gitignore`, new `NOTICE`.

---

## Phase 1 — Database foundation

### Task 1: Reusable migration runner

**Files:**
- Create: `apps/backend/src/db/runner.ts`
- Test: `apps/backend/src/db/runner.test.ts`
- Modify: `apps/backend/src/db/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/db/runner.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/backend && bun test src/db/runner.test.ts`
Expected: FAIL — `Cannot find module './runner'`.

- [ ] **Step 3: Implement the runner**

Create `apps/backend/src/db/runner.ts`:

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd apps/backend && bun test src/db/runner.test.ts`
Expected: PASS (1 pass).

- [ ] **Step 5: Refactor `db/index.ts` to use the runner**

Replace the entire contents of `apps/backend/src/db/index.ts` with:

```ts
import { join } from 'node:path';
import { openDatabase, runMigrations, type Migration } from './runner';

const DB_PATH = process.env.SWTCW_DB_PATH ?? './data/swtcw.sqlite';

export const db = openDatabase(DB_PATH);

const MIGRATIONS: Migration[] = [{ version: '001_swtcw', file: '001_swtcw.sql' }];

runMigrations(db, MIGRATIONS, join(import.meta.dir, 'migrations'));
```

- [ ] **Step 6: Verify the existing app still boots (swtcw unaffected)**

Run: `cd apps/backend && SWTCW_DB_PATH=/tmp/swtcw-boot.sqlite bun -e "import('./src/db/index.ts').then(() => console.log('db ok'))"`
Expected: prints `[db] applied migration 001_swtcw` then `db ok`. No errors. Clean up: `rm -f /tmp/swtcw-boot.sqlite*`.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/runner.ts apps/backend/src/db/runner.test.ts apps/backend/src/db/index.ts
git commit -m "Refactor db bootstrap into a reusable migration runner"
```

---

### Task 2: swdnd database, core-state migration, reference tables

**Files:**
- Create: `apps/backend/src/db/migrations/swdnd/001_swdnd_core.sql`
- Create: `apps/backend/src/db/swdnd/reference.ts`
- Create: `apps/backend/src/db/swdnd/index.ts`
- Test: `apps/backend/src/db/swdnd/reference.test.ts`

- [ ] **Step 1: Write the core-state migration**

Create `apps/backend/src/db/migrations/swdnd/001_swdnd_core.sql`:

```sql
CREATE TABLE campaign (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE player (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);

CREATE TABLE character (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  player_id   TEXT REFERENCES player(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  data_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_player_campaign ON player(campaign_id);
CREATE INDEX idx_character_campaign ON character(campaign_id);
CREATE INDEX idx_character_player ON character(player_id);

CREATE TABLE data_version (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  source_repo TEXT,
  commit_hash TEXT,
  imported_at TEXT
);
```

- [ ] **Step 2: Write the failing reference-tables test**

Create `apps/backend/src/db/swdnd/reference.test.ts`:

```ts
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

    // Common columns exist on a representative table.
    const cols = db
      .query<{ name: string }, []>('PRAGMA table_info(species)')
      .all()
      .map((r) => r.name);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'name', 'content_source', 'content_type', 'raw_json']),
    );

    // Extra column on classes.
    const classCols = db
      .query<{ name: string }, []>('PRAGMA table_info(classes)')
      .all()
      .map((r) => r.name);
    expect(classCols).toContain('caster_ratio');
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `cd apps/backend && bun test src/db/swdnd/reference.test.ts`
Expected: FAIL — `Cannot find module './reference'`.

- [ ] **Step 4: Implement the reference manifest**

Create `apps/backend/src/db/swdnd/reference.ts`:

```ts
import type { Database } from 'bun:sqlite';

export interface RefColumn {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL';
}

export interface RefTable {
  table: string;
  extra: RefColumn[];
}

// Columns present on every reference table.
const COMMON =
  'id TEXT PRIMARY KEY, name TEXT, content_source TEXT, content_type TEXT, raw_json TEXT NOT NULL';

/** The sw5e reference tables (see sw5e Rules Reference). raw_json holds the full doc. */
export const REFERENCE_TABLES: RefTable[] = [
  { table: 'species', extra: [] },
  { table: 'species_features', extra: [] },
  { table: 'classes', extra: [{ name: 'caster_type', type: 'TEXT' }, { name: 'caster_ratio', type: 'REAL' }] },
  { table: 'class_features', extra: [] },
  { table: 'archetypes', extra: [{ name: 'caster_type', type: 'TEXT' }, { name: 'caster_ratio', type: 'REAL' }] },
  { table: 'archetype_features', extra: [] },
  { table: 'backgrounds', extra: [] },
  { table: 'feats', extra: [] },
  { table: 'conditions', extra: [] },
  { table: 'fighting_styles', extra: [] },
  { table: 'fighting_masteries', extra: [] },
  { table: 'maneuvers', extra: [] },
  { table: 'lightsaber_forms', extra: [] },
  { table: 'invocations', extra: [] },
  { table: 'powers', extra: [{ name: 'power_type', type: 'TEXT' }, { name: 'level', type: 'INTEGER' }, { name: 'force_alignment', type: 'TEXT' }] },
  { table: 'weapons', extra: [{ name: 'classification', type: 'TEXT' }] },
  { table: 'weapon_properties', extra: [] },
  { table: 'armor', extra: [{ name: 'classification', type: 'TEXT' }] },
  { table: 'armor_properties', extra: [] },
  { table: 'gear', extra: [{ name: 'category', type: 'TEXT' }] },
  { table: 'modifications', extra: [] },
  { table: 'enhanced_items', extra: [] },
  { table: 'starship_sizes', extra: [] },
  { table: 'starship_equipment', extra: [] },
  { table: 'starship_weapons', extra: [] },
  { table: 'starship_armor', extra: [] },
  { table: 'starship_modifications', extra: [] },
  { table: 'starship_features', extra: [] },
  { table: 'starship_actions', extra: [] },
  { table: 'deployments', extra: [] },
  { table: 'deployment_features', extra: [] },
  { table: 'ventures', extra: [] },
  { table: 'monsters', extra: [] },
  { table: 'monster_traits', extra: [] },
];

/** Idempotently create all reference tables. */
export function ensureReferenceTables(db: Database): void {
  for (const t of REFERENCE_TABLES) {
    const extraCols = t.extra.map((c) => `, ${c.name} ${c.type}`).join('');
    db.exec(`CREATE TABLE IF NOT EXISTS ${t.table} (${COMMON}${extraCols})`);
  }
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd apps/backend && bun test src/db/swdnd/reference.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the swdnd database module**

Create `apps/backend/src/db/swdnd/index.ts`:

```ts
import { join } from 'node:path';
import { openDatabase, runMigrations, type Migration } from '../runner';
import { ensureReferenceTables } from './reference';

const DB_PATH = process.env.SWDND_DB_PATH ?? './data/swdnd.sqlite';

export const swdndDb = openDatabase(DB_PATH);

const MIGRATIONS: Migration[] = [{ version: '001_swdnd_core', file: '001_swdnd_core.sql' }];

runMigrations(swdndDb, MIGRATIONS, join(import.meta.dir, '..', 'migrations', 'swdnd'));
ensureReferenceTables(swdndDb);
```

- [ ] **Step 7: Verify the swdnd DB bootstraps**

Run: `cd apps/backend && SWDND_DB_PATH=/tmp/swdnd-test.sqlite bun -e "import('./src/db/swdnd/index.ts').then(({swdndDb}) => console.log(swdndDb.query(\"SELECT name FROM sqlite_master WHERE type='table'\").all().length, 'tables'))"`
Expected: prints a count `>= 38 tables` (34 reference + campaign/player/character/data_version + schema_migrations). No errors. Then `rm -f /tmp/swdnd-test.sqlite*`.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/db/swdnd apps/backend/src/db/migrations/swdnd
git commit -m "Add swdnd.sqlite: core-state migration + sw5e reference tables"
```

---

## Phase 2 — sw5e ingestion

### Task 3: Pure pack→row mapping

**Files:**
- Create: `apps/backend/src/db/import/sw5e-map.ts`
- Test: `apps/backend/src/db/import/sw5e-map.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/db/import/sw5e-map.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { mapFoundryDoc, PACK_SOURCES, type PackSource } from './sw5e-map';

const speciesSource: PackSource = { packDir: 'species', table: 'species' };
const forceSource: PackSource = { packDir: 'forcepowers', table: 'powers', fixed: { power_type: 'force' } };

describe('mapFoundryDoc', () => {
  it('maps common fields and stores raw_json', () => {
    const doc = { _id: 'abc123', name: 'Human', system: { source: 'PHB', contentType: 'Core' } };
    const row = mapFoundryDoc(speciesSource, doc);
    expect(row.id).toBe('abc123');
    expect(row.name).toBe('Human');
    expect(row.content_source).toBe('PHB');
    expect(row.content_type).toBe('Core');
    expect(JSON.parse(row.raw_json)).toEqual(doc);
    expect(row.extra).toEqual({});
  });

  it('applies fixed columns and extracts power level', () => {
    const doc = { _id: 'p1', name: 'Force Push', system: { level: 1 } };
    const row = mapFoundryDoc(forceSource, doc);
    expect(row.extra.power_type).toBe('force');
    expect(row.extra.level).toBe(1);
  });

  it('falls back to name when _id is missing and tolerates missing system', () => {
    const row = mapFoundryDoc(speciesSource, { name: 'Twi\'lek' });
    expect(row.id).toBe("Twi'lek");
    expect(row.content_source).toBeNull();
    expect(row.raw_json).toContain('Twi');
  });

  it('covers all sw5e pack directories without duplicate (packDir) entries', () => {
    const dirs = PACK_SOURCES.map((s) => s.packDir);
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(PACK_SOURCES.length).toBeGreaterThanOrEqual(40);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/backend && bun test src/db/import/sw5e-map.test.ts`
Expected: FAIL — `Cannot find module './sw5e-map'`.

- [ ] **Step 3: Implement the mapping**

Create `apps/backend/src/db/import/sw5e-map.ts`:

```ts
export interface PackSource {
  /** Directory under packs/ in the sw5e-foundry/sw5e repo. */
  packDir: string;
  /** Target reference table. */
  table: string;
  /** Constant extra-column values (e.g. { power_type: 'force' }). */
  fixed?: Record<string, string | number>;
}

/** Maps every sw5e Foundry pack directory to a reference table. */
export const PACK_SOURCES: PackSource[] = [
  { packDir: 'species', table: 'species' },
  { packDir: 'speciesfeatures', table: 'species_features' },
  { packDir: 'classes', table: 'classes' },
  { packDir: 'classfeatures', table: 'class_features' },
  { packDir: 'archetypes', table: 'archetypes' },
  { packDir: 'archetypefeatures', table: 'archetype_features' },
  { packDir: 'backgrounds', table: 'backgrounds' },
  { packDir: 'feats', table: 'feats' },
  { packDir: 'conditions', table: 'conditions' },
  { packDir: 'fightingstyles', table: 'fighting_styles' },
  { packDir: 'fightingmasteries', table: 'fighting_masteries' },
  { packDir: 'maneuvers', table: 'maneuvers' },
  { packDir: 'lightsaberforms', table: 'lightsaber_forms' },
  { packDir: 'invocations', table: 'invocations' },
  { packDir: 'forcepowers', table: 'powers', fixed: { power_type: 'force' } },
  { packDir: 'techpowers', table: 'powers', fixed: { power_type: 'tech' } },
  { packDir: 'blasters', table: 'weapons', fixed: { classification: 'blaster' } },
  { packDir: 'vibroweapons', table: 'weapons', fixed: { classification: 'vibroweapon' } },
  { packDir: 'lightweapons', table: 'weapons', fixed: { classification: 'lightweapon' } },
  { packDir: 'weaponproperties', table: 'weapon_properties' },
  { packDir: 'armor', table: 'armor' },
  { packDir: 'armorproperties', table: 'armor_properties' },
  { packDir: 'ammo', table: 'gear', fixed: { category: 'ammo' } },
  { packDir: 'adventuringgear', table: 'gear', fixed: { category: 'adventuring' } },
  { packDir: 'consumables', table: 'gear', fixed: { category: 'consumable' } },
  { packDir: 'explosives', table: 'gear', fixed: { category: 'explosive' } },
  { packDir: 'kits', table: 'gear', fixed: { category: 'kit' } },
  { packDir: 'implements', table: 'gear', fixed: { category: 'implement' } },
  { packDir: 'gamingsets', table: 'gear', fixed: { category: 'gamingset' } },
  { packDir: 'musicalinstruments', table: 'gear', fixed: { category: 'musicalinstrument' } },
  { packDir: 'modifications', table: 'modifications' },
  { packDir: 'enhanceditems', table: 'enhanced_items' },
  { packDir: 'starships', table: 'starship_sizes' },
  { packDir: 'starshipequipment', table: 'starship_equipment' },
  { packDir: 'starshipweapons', table: 'starship_weapons' },
  { packDir: 'starshiparmor', table: 'starship_armor' },
  { packDir: 'starshipmodifications', table: 'starship_modifications' },
  { packDir: 'starshipfeatures', table: 'starship_features' },
  { packDir: 'starshipactions', table: 'starship_actions' },
  { packDir: 'deployments', table: 'deployments' },
  { packDir: 'deploymentfeatures', table: 'deployment_features' },
  { packDir: 'ventures', table: 'ventures' },
  { packDir: 'monsters', table: 'monsters' },
  { packDir: 'monstertraits', table: 'monster_traits' },
];

export interface RefRow {
  id: string;
  name: string | null;
  content_source: string | null;
  content_type: string | null;
  raw_json: string;
  extra: Record<string, string | number | null>;
}

/** Best-effort extraction; raw_json always preserves the full Foundry document. */
export function mapFoundryDoc(source: PackSource, doc: any): RefRow {
  const system = (doc && typeof doc === 'object' ? doc.system : null) ?? {};
  const extra: Record<string, string | number | null> = { ...(source.fixed ?? {}) };

  if (source.table === 'powers' && typeof system.level === 'number') {
    extra.level = system.level;
  }
  if (source.table === 'classes' || source.table === 'archetypes') {
    extra.caster_type = typeof system.casterType === 'string' ? system.casterType : null;
    extra.caster_ratio = typeof system.casterRatio === 'number' ? system.casterRatio : null;
  }

  const source_field = system.source;
  const content_source =
    typeof source_field === 'string'
      ? source_field
      : source_field && typeof source_field.book === 'string'
        ? source_field.book
        : null;

  return {
    id: String(doc?._id ?? doc?.name ?? ''),
    name: typeof doc?.name === 'string' ? doc.name : null,
    content_source,
    content_type: typeof system.contentType === 'string' ? system.contentType : null,
    raw_json: JSON.stringify(doc),
    extra,
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd apps/backend && bun test src/db/import/sw5e-map.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db/import/sw5e-map.ts apps/backend/src/db/import/sw5e-map.test.ts
git commit -m "Add sw5e Foundry pack mapping (manifest + pure mapper)"
```

---

### Task 4: One-shot import script

**Files:**
- Create: `apps/backend/src/db/import/sw5e-import.ts`
- Modify: `.gitignore` (ignore the cloned source)

- [ ] **Step 1: Ignore the vendored source**

Append to `.gitignore`:

```gitignore

# sw5e source clone for the import script (not committed)
/vendor/
```

- [ ] **Step 2: Implement the import script**

Create `apps/backend/src/db/import/sw5e-import.ts`:

```ts
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

  console.log(`[sw5e-import] imported ${total} records into swdnd.sqlite`);
}

run();
```

- [ ] **Step 3: Clone the source and run the import (integration verification)**

Run:
```bash
cd /Users/asherc/Git/ashercarlow-api
git clone --depth 1 https://github.com/sw5e-foundry/sw5e.git vendor/sw5e
cd apps/backend && SWDND_DB_PATH=/tmp/swdnd-import.sqlite SW5E_PACKS_DIR=../../vendor/sw5e/packs bun run src/db/import/sw5e-import.ts
```
Expected: prints `[sw5e-import] imported N records into swdnd.sqlite` with **N in the thousands**.

- [ ] **Step 4: Spot-check the imported data**

Run:
```bash
cd apps/backend && SWDND_DB_PATH=/tmp/swdnd-import.sqlite bun -e "import('./src/db/swdnd/index.ts').then(({swdndDb})=>{const s=swdndDb.query('SELECT COUNT(*) c FROM species').get();const p=swdndDb.query('SELECT COUNT(*) c FROM powers').get();const v=swdndDb.query('SELECT source_repo, commit_hash FROM data_version WHERE id=1').get();console.log({species:s.c, powers:p.c, v});})"
```
Expected: `species.c > 0`, `powers.c > 0`, and `v` shows the repo + a commit hash. Then clean up: `rm -f /tmp/swdnd-import.sqlite*`.

- [ ] **Step 5: Commit**

```bash
cd /Users/asherc/Git/ashercarlow-api
git add apps/backend/src/db/import/sw5e-import.ts .gitignore
git commit -m "Add one-shot sw5e import script (Foundry packs -> swdnd.sqlite)"
```

---

## Phase 3 — Real-time backbone

### Task 5: WebSocket envelope, rooms, handler, publish

**Files:**
- Create: `apps/backend/src/lib/swdnd-realtime.ts`
- Test: `apps/backend/src/lib/swdnd-realtime.test.ts`

- [ ] **Step 1: Write the failing tests (pure helpers + WS integration)**

Create `apps/backend/src/lib/swdnd-realtime.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import {
  parseEnvelope,
  roomForCampaign,
  swdndWebsocket,
  setRealtimeServer,
  publishToRoom,
  type WsData,
} from './swdnd-realtime';

describe('parseEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(parseEnvelope('{"type":"x","room":"campaign:1"}')).toEqual({
      type: 'x',
      room: 'campaign:1',
    });
  });
  it('rejects malformed input', () => {
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('{"type":"x"}')).toBeNull();
  });
});

describe('roomForCampaign', () => {
  it('namespaces the room', () => {
    expect(roomForCampaign('abc')).toBe('campaign:abc');
  });
});

describe('websocket room fan-out', () => {
  it('delivers a published message to subscribers in the room', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        const room = roomForCampaign('t1');
        if (srv.upgrade<WsData>(req, { data: { room } })) return undefined;
        return new Response('no', { status: 400 });
      },
      websocket: swdndWebsocket,
    });
    setRealtimeServer(server);

    const url = `ws://localhost:${server.port}/swdnd/ws?campaign=t1`;
    const got = new Promise<string>((resolve) => {
      const ws = new WebSocket(url);
      ws.onmessage = (e) => {
        const env = JSON.parse(e.data as string);
        if (env.type === 'campaign:updated') resolve(env.payload);
      };
      ws.onopen = () => {
        setTimeout(() => publishToRoom(roomForCampaign('t1'), {
          type: 'campaign:updated',
          room: roomForCampaign('t1'),
          payload: 'hello',
        }), 50);
      };
    });

    expect(await got).toBe('hello');
    server.stop(true);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd apps/backend && bun test src/lib/swdnd-realtime.test.ts`
Expected: FAIL — `Cannot find module './swdnd-realtime'`.

- [ ] **Step 3: Implement the realtime module**

Create `apps/backend/src/lib/swdnd-realtime.ts`:

```ts
import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';

export interface WsEnvelope {
  type: string;
  room: string;
  payload?: unknown;
}

export interface WsData {
  room: string;
}

let serverRef: Server | null = null;

/** Wire the running Bun server so REST handlers can broadcast. Call once after Bun.serve. */
export function setRealtimeServer(server: Server): void {
  serverRef = server;
}

/** Room key for a campaign. */
export function roomForCampaign(campaignId: string): string {
  return `campaign:${campaignId}`;
}

/** Broadcast an envelope to everyone in a room. No-op until the server is wired. */
export function publishToRoom(room: string, env: WsEnvelope): void {
  serverRef?.publish(room, JSON.stringify(env));
}

/** Parse + minimally validate an inbound message. Returns null when malformed. */
export function parseEnvelope(raw: string): WsEnvelope | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.type === 'string' && typeof obj.room === 'string') {
      return obj as WsEnvelope;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export const swdndWebsocket: WebSocketHandler<WsData> = {
  open(ws: ServerWebSocket<WsData>) {
    ws.subscribe(ws.data.room);
    ws.send(JSON.stringify({ type: 'joined', room: ws.data.room }));
  },
  message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
    const env = parseEnvelope(typeof message === 'string' ? message : message.toString());
    if (!env || env.room !== ws.data.room) return;
    // Foundation: relay ephemeral client messages to the rest of the room.
    // Authoritative state changes go through REST + publishToRoom.
    ws.publish(ws.data.room, JSON.stringify(env));
  },
  close(ws: ServerWebSocket<WsData>) {
    ws.unsubscribe(ws.data.room);
  },
};
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `cd apps/backend && bun test src/lib/swdnd-realtime.test.ts`
Expected: PASS (4 pass) — including the fan-out integration test.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/swdnd-realtime.ts apps/backend/src/lib/swdnd-realtime.test.ts
git commit -m "Add swdnd WebSocket backbone (rooms, envelope, publish)"
```

---

## Phase 4 — API routes

### Task 6: Auth gate + content read routes

**Files:**
- Create: `apps/backend/src/routes/swdnd/content.ts`
- Create: `apps/backend/src/routes/swdnd/index.ts`

- [ ] **Step 1: Implement the content routes**

Create `apps/backend/src/routes/swdnd/content.ts`:

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { REFERENCE_TABLES } from '../../db/swdnd/reference';

const VALID_CATEGORIES = new Set(REFERENCE_TABLES.map((t) => t.table));
const ErrorBody = z.object({ message: z.string() });

const listContentRoute = createRoute({
  method: 'get',
  path: '/swdnd/content/{category}',
  tags: ['swdnd'],
  summary: 'List sw5e reference content for a category (e.g. species, classes, powers)',
  request: {
    params: z.object({ category: z.string().openapi({ example: 'species' }) }),
  },
  responses: {
    200: {
      description: 'Reference rows for the category',
      content: { 'application/json': { schema: z.array(z.record(z.any())) } },
    },
    404: {
      description: 'Unknown category',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

export function registerContentRoutes(app: OpenAPIHono): void {
  app.openapi(listContentRoute, (c) => {
    const { category } = c.req.valid('param');
    if (!VALID_CATEGORIES.has(category)) {
      throw new HTTPException(404, { message: `Unknown category: ${category}` });
    }
    const rows = swdndDb.query(`SELECT * FROM ${category} ORDER BY name ASC`).all();
    return c.json(rows, 200);
  });
}
```

- [ ] **Step 2: Implement the swdnd registration + auth gate**

Create `apps/backend/src/routes/swdnd/index.ts`:

```ts
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { isCookieAuthed } from '../auth';
import { registerContentRoutes } from './content';
import { registerCampaignRoutes } from './campaigns';

// Mirror swtcw: GETs are open; mutations require the admin token or cookie.
// In dev (no ASHERCARLOW_AUTH_TOKEN) everything passes.
function authGate(c: Context): Response | null {
  if (c.req.method === 'GET') return null;
  const expected = process.env.ASHERCARLOW_AUTH_TOKEN;
  if (!expected) return null;
  const header = c.req.header('Authorization');
  if (header?.replace('Bearer ', '') === expected) return null;
  if (isCookieAuthed(c)) return null;
  return Response.json({ message: 'Unauthorized' }, { status: 401 });
}

export function registerSwdndRoutes(app: OpenAPIHono): void {
  app.use('/swdnd/*', async (c, next) => {
    const blocked = authGate(c);
    if (blocked) return blocked;
    return next();
  });

  registerContentRoutes(app);
  registerCampaignRoutes(app);
}
```

> Note: this imports `./campaigns` (Task 7). It will not typecheck until Task 7 is done — that's expected; do Task 7 next, then verify together in Task 8.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/routes/swdnd/content.ts apps/backend/src/routes/swdnd/index.ts
git commit -m "Add swdnd content routes + auth-gated registration"
```

---

### Task 7: Campaign routes (+ WS broadcast)

**Files:**
- Create: `apps/backend/src/routes/swdnd/campaigns.ts`

- [ ] **Step 1: Implement the campaign routes**

Create `apps/backend/src/routes/swdnd/campaigns.ts`:

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';

const Campaign = z
  .object({
    id: z.string(),
    name: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('SwdndCampaign');

type CampaignRow = z.infer<typeof Campaign>;
const ErrorBody = z.object({ message: z.string() });
const PostBody = z.object({ name: z.string().min(1) }).openapi('SwdndPostCampaign');
const PatchBody = z.object({ name: z.string().min(1) }).openapi('SwdndPatchCampaign');

const listRoute = createRoute({
  method: 'get',
  path: '/swdnd/campaigns',
  tags: ['swdnd'],
  summary: 'List campaigns',
  responses: {
    200: { description: 'Campaigns', content: { 'application/json': { schema: z.array(Campaign) } } },
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/swdnd/campaigns/{id}',
  tags: ['swdnd'],
  summary: 'Get one campaign',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Campaign', content: { 'application/json': { schema: Campaign } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const postRoute = createRoute({
  method: 'post',
  path: '/swdnd/campaigns',
  tags: ['swdnd'],
  summary: 'Create a campaign (DM only)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Campaign } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/swdnd/campaigns/{id}',
  tags: ['swdnd'],
  summary: 'Rename a campaign (DM only); broadcasts to the campaign room',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PatchBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Campaign } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerCampaignRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const rows = swdndDb
      .query<CampaignRow, []>('SELECT id, name, created_at, updated_at FROM campaign ORDER BY created_at DESC')
      .all();
    return c.json(rows, 200);
  });

  app.openapi(getRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = swdndDb
      .query<CampaignRow, [string]>('SELECT id, name, created_at, updated_at FROM campaign WHERE id = ?')
      .get(id);
    if (!row) throw new HTTPException(404, { message: 'Campaign not found' });
    return c.json(row, 200);
  });

  app.openapi(postRoute, (c) => {
    const { name } = c.req.valid('json');
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO campaign (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, name, now, now],
    );
    return c.json({ id, name, created_at: now, updated_at: now }, 201);
  });

  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const existing = swdndDb
      .query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?')
      .get(id);
    if (!existing) throw new HTTPException(404, { message: 'Campaign not found' });

    const now = new Date().toISOString();
    swdndDb.run('UPDATE campaign SET name = ?, updated_at = ? WHERE id = ?', [name, now, id]);
    const updated = swdndDb
      .query<CampaignRow, [string]>('SELECT id, name, created_at, updated_at FROM campaign WHERE id = ?')
      .get(id)!;

    const room = roomForCampaign(id);
    publishToRoom(room, { type: 'campaign:updated', room, payload: updated });
    return c.json(updated, 200);
  });
}
```

- [ ] **Step 2: Verify the route modules load (Bun strips types; this catches syntax/import errors)**

Run: `cd apps/backend && SWDND_DB_PATH=/tmp/swdnd-load.sqlite bun -e "import('./src/routes/swdnd/index.ts').then(() => console.log('swdnd routes ok'))"`
Expected: prints `swdnd routes ok` (the import resolves `content.ts`, `campaigns.ts`, `db/swdnd`, and `lib/swdnd-realtime`). No errors. Clean up: `rm -f /tmp/swdnd-load.sqlite*`. Full behavior is verified in Task 8.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/routes/swdnd/campaigns.ts
git commit -m "Add swdnd campaign routes with WebSocket broadcast"
```

---

### Task 8: Wire routes, host dispatch, static, CORS, WS upgrade

**Files:**
- Modify: `apps/backend/src/lib/openapi.ts`
- Modify: `apps/backend/src/middleware/cors.ts`
- Modify: `apps/backend/src/index.ts`

- [ ] **Step 1: Register swdnd routes**

In `apps/backend/src/lib/openapi.ts`, add the import alongside the others:

```ts
import { registerSwdndRoutes } from '../routes/swdnd';
```

And add the call after `registerSwtcwRoutes(app);`:

```ts
  registerSwtcwRoutes(app);
  registerSwdndRoutes(app);
```

- [ ] **Step 2: Allow the swdnd host in CORS**

In `apps/backend/src/middleware/cors.ts`, add to `ALLOWED_HOSTS`:

```ts
  'starwars.ashercarlow.com',
  'swdnd.ashercarlow.com',
  'api.ashercarlow.com',
```

- [ ] **Step 3: Wire host dispatch + static + WS upgrade**

In `apps/backend/src/index.ts`:

(a) Add the realtime imports at the top, after the existing imports:

```ts
import { swdndWebsocket, setRealtimeServer, roomForCampaign, type WsData } from './lib/swdnd-realtime';
```

(b) Add the dist env var after `STARWARS_DIST`:

```ts
const SWDND_DIST = process.env.SWDND_DIST ?? 'apps/swdnd/dist';
```

(c) Add the host to `FRONTEND_HOSTS`:

```ts
  'starwars.ashercarlow.com',
  'swdnd.ashercarlow.com',
]);
```

(d) Change the server to handle WS upgrades and the new host. Replace the `Bun.serve({ ... })` call's `fetch` signature and body start so it receives `server`, and add the upgrade branch + the host case. The updated `Bun.serve` block:

```ts
const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const host = effectiveHost(req.headers.get('host'));
    const pathname = new URL(req.url).pathname;

    // swdnd realtime upgrade (api host). room = campaign.
    if (host === 'api.ashercarlow.com' && pathname === '/swdnd/ws') {
      const campaign = new URL(req.url).searchParams.get('campaign');
      if (!campaign) return new Response('Missing campaign', { status: 400 });
      const upgraded = server.upgrade<WsData>(req, {
        data: { room: roomForCampaign(campaign) },
      });
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 426 });
    }

    // Standalone login page — served on every frontend host so any subdomain can be the
    // landing point. The form POSTs to api.ashercarlow.com/auth/login and the cookie is
    // scoped to .ashercarlow.com.
    if (pathname === '/login' && FRONTEND_HOSTS.has(host)) {
      return new Response(LOGIN_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    switch (host) {
      case 'ashercarlow.com':
      case 'www.ashercarlow.com':
        return serveStaticSpa(req, RESUME_DIST);
      case 'paulina.ashercarlow.com':
        return serveStaticSpa(req, WEDDING_DIST);
      case 'starwars.ashercarlow.com':
        return serveStaticSpa(req, STARWARS_DIST);
      case 'swdnd.ashercarlow.com':
        return serveStaticSpa(req, SWDND_DIST);
      case 'api.ashercarlow.com':
        return api.fetch(req);
      default:
        return new Response(`Unknown host: ${host}`, { status: 404 });
    }
  },
  websocket: swdndWebsocket,
});

setRealtimeServer(server);
```

(e) Add a startup log line after the starwars one:

```ts
console.log(`  • Swdnd:          host=swdnd.ashercarlow.com → ${SWDND_DIST}`);
```

- [ ] **Step 4: Boot the backend and verify routes + WS end-to-end**

Start it (writes to a temp DB so it doesn't touch real data):
```bash
cd apps/backend && SWDND_DB_PATH=/tmp/swdnd-e2e.sqlite SWTCW_DB_PATH=/tmp/swtcw-e2e.sqlite bun src/index.ts &
sleep 1
```
Then:
```bash
# content route (empty array OK if not imported in this temp DB; 200 + JSON array is the check)
curl -s -H 'Host: api.ashercarlow.com' localhost:3000/swdnd/content/species | head -c 80; echo
# unknown category -> 404 JSON
curl -s -H 'Host: api.ashercarlow.com' localhost:3000/swdnd/content/bogus; echo
# create a campaign (dev mode: no token configured -> allowed)
curl -s -X POST -H 'Host: api.ashercarlow.com' -H 'Content-Type: application/json' -d '{"name":"Test"}' localhost:3000/swdnd/campaigns; echo
# list campaigns
curl -s -H 'Host: api.ashercarlow.com' localhost:3000/swdnd/campaigns; echo
```
Expected: species returns `[` (a JSON array), bogus returns `{"message":"Unknown category: bogus"}`, POST returns a campaign object with an `id`, list includes it.

- [ ] **Step 5: Stop the server and clean up**

Run: `kill %1 2>/dev/null; rm -f /tmp/swdnd-e2e.sqlite* /tmp/swtcw-e2e.sqlite*`

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lib/openapi.ts apps/backend/src/middleware/cors.ts apps/backend/src/index.ts
git commit -m "Dispatch swdnd host + wire /swdnd routes and WebSocket upgrade"
```

---

## Phase 5 — Frontend scaffold

### Task 9: App config + entry

**Files (create):** `apps/swdnd/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `index.html`, `src/index.css`, `src/main.tsx`

- [ ] **Step 1: Create `apps/swdnd/package.json`**

```json
{
  "name": "@ashercarlow/swdnd",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.0",
    "@types/node": "^24.10.1",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "tailwindcss": "^4.2.0",
    "typescript": "~5.9.3",
    "vite": "^7.3.1"
  }
}
```

- [ ] **Step 2: Create `apps/swdnd/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
  },
});
```

- [ ] **Step 3: Create the three tsconfig files**

`apps/swdnd/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`apps/swdnd/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

`apps/swdnd/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "types": ["node"],
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `apps/swdnd/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#09090b" />
    <title>swdnd · ashercarlow</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/swdnd/src/index.css`**

```css
@import "tailwindcss";

html, body, #root {
  height: 100%;
  margin: 0;
}
```

- [ ] **Step 6: Create `apps/swdnd/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7: Install workspace deps**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun install`
Expected: resolves and installs swdnd's React deps. No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/swdnd/package.json apps/swdnd/vite.config.ts apps/swdnd/tsconfig*.json apps/swdnd/index.html apps/swdnd/src/index.css apps/swdnd/src/main.tsx bun.lock
git commit -m "Scaffold apps/swdnd (React + Vite + Tailwind config + entry)"
```

---

### Task 10: Frontend libs (api, ws, auth)

**Files (create):** `apps/swdnd/src/lib/api.ts`, `ws.ts`, `auth.tsx`

- [ ] **Step 1: Create `apps/swdnd/src/lib/api.ts`**

```ts
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://api.ashercarlow.com";

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ message: "Request failed" }))) as {
      message?: string;
    };
    throw new Error(err.message ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Returns whether the current request carries a valid admin session cookie. */
export async function getAuthMe(): Promise<boolean> {
  try {
    const body = await api<{ authed?: boolean }>("/auth/me");
    return !!body.authed;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create `apps/swdnd/src/lib/ws.ts`**

```ts
import { API_BASE } from "./api";

export interface WsEnvelope {
  type: string;
  room: string;
  payload?: unknown;
}

export interface CampaignSocket {
  send(env: WsEnvelope): void;
  close(): void;
}

function wsBase(): string {
  return API_BASE.replace(/^http/, "ws");
}

/** Connect to a campaign room with auto-reconnect. */
export function connectCampaign(
  campaignId: string,
  onMessage: (env: WsEnvelope) => void,
  onStatus?: (open: boolean) => void,
): CampaignSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const open = () => {
    ws = new WebSocket(
      `${wsBase()}/swdnd/ws?campaign=${encodeURIComponent(campaignId)}`,
    );
    ws.onopen = () => {
      retry = 0;
      onStatus?.(true);
    };
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) {
        retry += 1;
        setTimeout(open, Math.min(1000 * retry, 5000));
      }
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data as string) as WsEnvelope);
      } catch {
        /* ignore non-JSON frames */
      }
    };
  };
  open();

  return {
    send(env) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env));
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
```

- [ ] **Step 3: Create `apps/swdnd/src/lib/auth.tsx`**

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getAuthMe } from "./api";

interface AuthState {
  authed: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  authed: false,
  loading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setAuthed(await getAuthMe());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <AuthContext.Provider value={{ authed, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/swdnd/src/lib
git commit -m "Add swdnd frontend libs: api client, WebSocket client, auth context"
```

---

### Task 11: Panels, layouts, routing

**Files (create):** `apps/swdnd/src/panels/CharacterSheet/index.tsx`, `Tabletop/index.tsx`, `DMScreen/index.tsx`, `apps/swdnd/src/layouts/SinglePanel.tsx`, `SplitView.tsx`, `apps/swdnd/src/App.tsx`

- [ ] **Step 1: Create `apps/swdnd/src/panels/CharacterSheet/index.tsx`**

```tsx
export default function CharacterSheet({ characterId }: { characterId: string }) {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">Character Sheet</h1>
      <p className="text-zinc-400">Character: {characterId || "—"}</p>
      <p className="mt-4 text-zinc-500">
        Coming soon — built on the sw5e data layer.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Create `apps/swdnd/src/panels/Tabletop/index.tsx`**

```tsx
import { useEffect, useState } from "react";
import { connectCampaign } from "../../lib/ws";

export default function Tabletop({ campaignId }: { campaignId: string }) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    if (!campaignId) return;
    const sock = connectCampaign(
      campaignId,
      (env) => setEvents((prev) => [env.type, ...prev].slice(0, 20)),
      setConnected,
    );
    return () => sock.close();
  }, [campaignId]);

  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">Tabletop / Map</h1>
      <p className="text-zinc-400">
        Campaign: {campaignId || "—"} · {connected ? "live" : "connecting…"}
      </p>
      <ul className="mt-4 space-y-1 text-sm text-zinc-500">
        {events.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <p className="mt-4 text-zinc-500">Coming soon — real-time shared map.</p>
    </section>
  );
}
```

- [ ] **Step 3: Create `apps/swdnd/src/panels/DMScreen/index.tsx`**

```tsx
export default function DMScreen({ campaignId }: { campaignId: string }) {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">DM Screen</h1>
      <p className="text-zinc-400">Campaign: {campaignId || "—"}</p>
      <p className="mt-4 text-zinc-500">
        Coming soon — campaign control surface.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Create `apps/swdnd/src/layouts/SinglePanel.tsx`**

```tsx
import type { ReactNode } from "react";

export default function SinglePanel({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">{children}</div>
  );
}
```

- [ ] **Step 5: Create `apps/swdnd/src/layouts/SplitView.tsx`**

```tsx
import type { ReactNode } from "react";

export default function SplitView({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 grid grid-cols-1 md:grid-cols-2 md:divide-x divide-zinc-800">
      <div className="overflow-auto">{left}</div>
      <div className="overflow-auto">{right}</div>
    </div>
  );
}
```

- [ ] **Step 6: Create `apps/swdnd/src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import SinglePanel from "./layouts/SinglePanel";
import SplitView from "./layouts/SplitView";
import CharacterSheet from "./panels/CharacterSheet";
import Tabletop from "./panels/Tabletop";
import DMScreen from "./panels/DMScreen";

function SheetPage() {
  const { characterId = "" } = useParams();
  return (
    <SinglePanel>
      <CharacterSheet characterId={characterId} />
    </SinglePanel>
  );
}

function MapPage() {
  const { campaignId = "" } = useParams();
  return (
    <SinglePanel>
      <Tabletop campaignId={campaignId} />
    </SinglePanel>
  );
}

function DmPage() {
  const { campaignId = "" } = useParams();
  return (
    <SinglePanel>
      <DMScreen campaignId={campaignId} />
    </SinglePanel>
  );
}

function PlayPage() {
  // Foundation: character→campaign association is resolved in the Character
  // Sheets feature. For now the split view proves both panels compose; the
  // map uses the characterId as a placeholder room.
  const { characterId = "" } = useParams();
  return (
    <SplitView
      left={<CharacterSheet characterId={characterId} />}
      right={<Tabletop campaignId={characterId} />}
    />
  );
}

function Landing() {
  return (
    <SinglePanel>
      <div className="p-6">
        <h1 className="text-2xl font-bold">swdnd</h1>
        <p className="text-zinc-400">Star Wars D&amp;D — sw5e</p>
      </div>
    </SinglePanel>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/sheet/:characterId" element={<SheetPage />} />
          <Route path="/map/:campaignId" element={<MapPage />} />
          <Route path="/dm/:campaignId" element={<DmPage />} />
          <Route path="/play/:characterId" element={<PlayPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 7: Build the frontend**

Run: `cd apps/swdnd && bun run build`
Expected: `tsc -b` passes with no type errors and Vite writes `apps/swdnd/dist/` (an `index.html` + assets). Verify: `ls apps/swdnd/dist/index.html`.

- [ ] **Step 8: Commit**

```bash
cd /Users/asherc/Git/ashercarlow-api
git add apps/swdnd/src/panels apps/swdnd/src/layouts apps/swdnd/src/App.tsx
git commit -m "Add swdnd panels, layouts, and routing (composable single/split views)"
```

---

## Phase 6 — Infra & licensing

### Task 12: Root build scripts, Docker, compose

**Files:**
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add the build script**

In root `package.json`, add after `build:starwars`:

```json
    "build:starwars": "cd apps/starwars && bun run build",
    "build:swdnd": "cd apps/swdnd && bun run build",
    "build:frontends": "bun run build:resume && bun run build:wedding && bun run build:starwars && bun run build:swdnd"
```

- [ ] **Step 2: Add the swdnd build + copy to the Dockerfile**

In `Dockerfile` builder stage, add the manifest copy after the starwars one:

```dockerfile
COPY apps/starwars/package.json ./apps/starwars/
COPY apps/swdnd/package.json ./apps/swdnd/
```

Add the build to the frontend build command:

```dockerfile
RUN cd apps/resume   && bun run build && cd ../.. \
 && cd apps/wedding  && bun run build && cd ../.. \
 && cd apps/starwars && bun run build && cd ../.. \
 && cd apps/swdnd    && bun run build && cd ../..
```

In the runner stage, add the manifest copy after the starwars one:

```dockerfile
COPY apps/starwars/package.json ./apps/starwars/
COPY apps/swdnd/package.json ./apps/swdnd/
```

And the dist copy after the starwars one:

```dockerfile
COPY --from=builder /app/apps/starwars/dist ./apps/starwars/dist
COPY --from=builder /app/apps/swdnd/dist ./apps/swdnd/dist
```

- [ ] **Step 3: Add the swdnd DB path to compose**

In `docker-compose.yml`, add to the `environment:` list after `SWTCW_DB_PATH`:

```yaml
      - SWTCW_DB_PATH=/app/data/swtcw.sqlite
      - SWDND_DB_PATH=/app/data/swdnd.sqlite
```

- [ ] **Step 4: Verify the full frontend build runs**

Run: `cd /Users/asherc/Git/ashercarlow-api && bun run build:frontends`
Expected: all four builds succeed; `apps/swdnd/dist/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add package.json Dockerfile docker-compose.yml
git commit -m "Wire swdnd into build scripts, Dockerfile, and compose"
```

---

### Task 13: Licensing NOTICE

**Files:**
- Create: `NOTICE`

- [ ] **Step 1: Create `NOTICE` at the repo root**

```text
swdnd — sw5e content attribution & licensing
============================================

The swdnd module imports game content from the Star Wars 5e (sw5e) project's
Foundry VTT system repository:

  Source:  https://github.com/sw5e-foundry/sw5e  (packs/, GPL-3.0)

Notes:
- The sw5e Foundry system code/data is licensed GPL-3.0. Redistribution of the
  imported data files or derivative code carries GPL-3.0 obligations.
- sw5e is an unofficial fan project. Its content rests on unlicensed Star Wars
  intellectual property and is NOT affiliated with or endorsed by sw5e.com,
  Disney, Lucasfilm, or Wizards of the Coast.
- This application is for personal, non-commercial use only.

The sw5e website API (https://sw5eapi.azurewebsites.net/api/) carries no license
and is used (if at all) only for cross-checking, never redistribution.
```

- [ ] **Step 2: Commit**

```bash
git add NOTICE
git commit -m "Add NOTICE: sw5e attribution and licensing"
```

---

## Final verification

- [ ] **Step 1: Run the full backend test suite**

Run: `cd apps/backend && bun test`
Expected: all suites pass (runner, reference, sw5e-map, swdnd-realtime).

- [ ] **Step 2: Boot the whole app and smoke-test swdnd serving + API**

```bash
cd /Users/asherc/Git/ashercarlow-api && bun run build:swdnd
cd apps/backend && SWDND_DB_PATH=/tmp/swdnd-final.sqlite SWTCW_DB_PATH=/tmp/swtcw-final.sqlite bun src/index.ts &
sleep 1
curl -s -H 'Host: swdnd.ashercarlow.com' localhost:3000/ | grep -q '<div id="root">' && echo "SPA OK"
curl -s -H 'Host: api.ashercarlow.com' localhost:3000/swdnd/campaigns; echo
kill %1 2>/dev/null; rm -f /tmp/swdnd-final.sqlite* /tmp/swtcw-final.sqlite*
```
Expected: `SPA OK` printed, and the campaigns endpoint returns a JSON array.

- [ ] **Step 3: Confirm existing properties still serve (no regression)**

```bash
cd apps/backend && SWTCW_DB_PATH=/tmp/swtcw-reg.sqlite SWDND_DB_PATH=/tmp/swdnd-reg.sqlite bun src/index.ts &
sleep 1
curl -s -H 'Host: api.ashercarlow.com' localhost:3000/swtcw/episodes | head -c 40; echo
curl -s -H 'Host: api.ashercarlow.com' localhost:3000/ ; echo
kill %1 2>/dev/null; rm -f /tmp/swtcw-reg.sqlite* /tmp/swdnd-reg.sqlite*
```
Expected: swtcw episodes returns JSON, root returns the `{ ok: true, ... }` service object. No errors.

---

## Notes for the implementer

- **sw5e import is operator-run, not part of boot.** The backend boot only ensures schema; populate data by cloning `sw5e-foundry/sw5e` into `vendor/` and running `src/db/import/sw5e-import.ts` (Task 4). In production, run the import once against the mounted `/app/data/swdnd.sqlite`.
- **Foundry field paths are best-effort.** `mapFoundryDoc` extracts a few indexed columns defensively and always preserves the full document in `raw_json`. If the Character Sheets feature needs richer columns (e.g. verified caster ratios), refine extraction there — the raw data is never lost.
- **WS is fan-out, REST is truth.** The only authoritative broadcast wired in the foundation is `campaign:updated` from the PATCH route. Feature specs add more message types.
- **Player/character routes are intentionally deferred** to the Character Sheets feature; only the tables exist now.
