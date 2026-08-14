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
  { table: 'classes', extra: [] },
  { table: 'class_features', extra: [] },
  { table: 'archetypes', extra: [] },
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
  // Pre-built named starships. NOTE the confusing pair: the sw5e pack DIRECTORY
  // called `starships` holds the six size chassis and feeds `starship_sizes`;
  // THIS table is fed by the `drakes-shipyard` pack (87 actor documents).
  { table: 'starships', extra: [] },
];

/** Idempotently create all reference tables. */
export function ensureReferenceTables(db: Database): void {
  for (const t of REFERENCE_TABLES) {
    const extraCols = t.extra.map((c) => `, ${c.name} ${c.type}`).join('');
    db.exec(`CREATE TABLE IF NOT EXISTS ${t.table} (${COMMON}${extraCols})`);
  }
}
