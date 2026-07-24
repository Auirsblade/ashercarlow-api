import { join } from 'node:path';
import { openDatabase, runMigrations, type Migration } from '../runner';
import { ensureReferenceTables } from './reference';
import { seedContentFromImage } from './seed';

const DB_PATH = process.env.SWDND_DB_PATH ?? './data/swdnd.sqlite';

export const swdndDb = openDatabase(DB_PATH);

const MIGRATIONS: Migration[] = [
  { version: '001_swdnd_core', file: '001_swdnd_core.sql' },
  { version: '002_swdnd_map', file: '002_swdnd_map.sql' },
  { version: '003_swdnd_templates', file: '003_swdnd_templates.sql' },
  { version: '004_swdnd_encounters', file: '004_swdnd_encounters.sql' },
  { version: '005_swdnd_rolls', file: '005_swdnd_rolls.sql' },
];

runMigrations(swdndDb, MIGRATIONS, join(import.meta.dir, '..', 'migrations', 'swdnd'));
ensureReferenceTables(swdndDb);
seedContentFromImage(swdndDb);
