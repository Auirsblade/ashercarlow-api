import { join } from 'node:path';
import { openDatabase, runMigrations, type Migration } from './runner';

const DB_PATH = process.env.SWTCW_DB_PATH ?? './data/swtcw.sqlite';

export const db = openDatabase(DB_PATH);

const MIGRATIONS: Migration[] = [{ version: '001_swtcw', file: '001_swtcw.sql' }];

runMigrations(db, MIGRATIONS, join(import.meta.dir, 'migrations'));
