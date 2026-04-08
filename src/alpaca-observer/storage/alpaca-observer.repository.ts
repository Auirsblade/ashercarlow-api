import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SQLite repository for the Alpaca iron condor observer.
 *
 * Same shape as kalshi-observer's repository: schema created at module init,
 * `useInMemoryForTests()` helper for unit tests, no migrations.
 */

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'alpaca-observer.sqlite');

export interface CondorPositionRow {
  id?: number;
  /** Our local UUID, distinct from Alpaca's order id */
  local_id: string;
  /** Alpaca parent order id (mleg) once placed */
  alpaca_order_id: string | null;
  cycle_month: string; // YYYY-MM
  opened_at: string;
  expiration_date: string;
  status:
    | 'pending'
    | 'open'
    | 'closing'
    | 'closed_expired'
    | 'closed_stop'
    | 'closed_manual'
    | 'errored';
  short_put_strike: number;
  long_put_strike: number;
  short_call_strike: number;
  long_call_strike: number;
  /** Net credit per spread, positive number; stored as $ per contract */
  credit_received: number | null;
  /** Worst-case loss per contract */
  max_loss: number;
  contracts: number;
  /** Was this a dry-run (no real Alpaca submission)? */
  dry_run: number;
  closed_at?: string | null;
  realized_pnl?: number | null;
  exit_reason?: string | null;
  notes?: string | null;
}

export interface CondorLegRow {
  id?: number;
  position_id: number;
  side: 'short_put' | 'long_put' | 'short_call' | 'long_call';
  contract_symbol: string;
  strike: number;
  expiration: string;
  alpaca_leg_order_id: string | null;
  fill_price: number | null;
  fill_qty: number | null;
}

export interface MarkToMarketRow {
  id?: number;
  position_id: number;
  sampled_at: string;
  spy_spot: number | null;
  vix: number | null;
  mid_value: number | null;
  unrealized_pnl: number | null;
}

export interface SignalSampleRow {
  id?: number;
  sampled_at: string;
  spy_spot: number | null;
  vix: number | null;
  rv30: number | null;
  vrp: number | null;
  regime: 'favorable' | 'vol_too_low' | 'vol_too_high' | 'unknown';
  entry_eligible: number;
}

export interface EntryDecisionRow {
  id?: number;
  cycle_month: string;
  decided_at: string;
  decision: 'open' | 'skip';
  reason: string;
  position_id: number | null;
}

export interface AccountSnapshotRow {
  id?: number;
  sampled_at: string;
  cash: number | null;
  equity: number | null;
  buying_power: number | null;
  open_positions: number;
}

@Injectable()
export class AlpacaObserverRepository implements OnModuleInit {
  private readonly logger = new Logger(AlpacaObserverRepository.name);
  private db!: Database.Database;

  onModuleInit(): void {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.logger.log(`Alpaca observer database ready at ${DB_PATH}`);
  }

  useInMemoryForTests(): void {
    if (this.db) this.db.close();
    this.db = new Database(':memory:');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  close(): void {
    if (this.db) this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS condor_position (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT NOT NULL UNIQUE,
        alpaca_order_id TEXT,
        cycle_month TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        expiration_date TEXT NOT NULL,
        status TEXT NOT NULL,
        short_put_strike REAL NOT NULL,
        long_put_strike REAL NOT NULL,
        short_call_strike REAL NOT NULL,
        long_call_strike REAL NOT NULL,
        credit_received REAL,
        max_loss REAL NOT NULL,
        contracts INTEGER NOT NULL DEFAULT 1,
        dry_run INTEGER NOT NULL DEFAULT 1,
        closed_at TEXT,
        realized_pnl REAL,
        exit_reason TEXT,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_condor_status ON condor_position(status);
      CREATE INDEX IF NOT EXISTS idx_condor_cycle ON condor_position(cycle_month);

      CREATE TABLE IF NOT EXISTS condor_leg (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL REFERENCES condor_position(id),
        side TEXT NOT NULL,
        contract_symbol TEXT NOT NULL,
        strike REAL NOT NULL,
        expiration TEXT NOT NULL,
        alpaca_leg_order_id TEXT,
        fill_price REAL,
        fill_qty REAL
      );
      CREATE INDEX IF NOT EXISTS idx_leg_position ON condor_leg(position_id);

      CREATE TABLE IF NOT EXISTS mark_to_market (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL REFERENCES condor_position(id),
        sampled_at TEXT NOT NULL,
        spy_spot REAL,
        vix REAL,
        mid_value REAL,
        unrealized_pnl REAL
      );
      CREATE INDEX IF NOT EXISTS idx_mtm_position_time
        ON mark_to_market(position_id, sampled_at);

      CREATE TABLE IF NOT EXISTS signal_sample (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sampled_at TEXT NOT NULL,
        spy_spot REAL,
        vix REAL,
        rv30 REAL,
        vrp REAL,
        regime TEXT NOT NULL,
        entry_eligible INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_signal_time ON signal_sample(sampled_at);

      CREATE TABLE IF NOT EXISTS entry_decision (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_month TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        position_id INTEGER REFERENCES condor_position(id)
      );
      CREATE INDEX IF NOT EXISTS idx_decision_cycle ON entry_decision(cycle_month);

      CREATE TABLE IF NOT EXISTS account_snapshot (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sampled_at TEXT NOT NULL,
        cash REAL,
        equity REAL,
        buying_power REAL,
        open_positions INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_account_time ON account_snapshot(sampled_at);
    `);
  }

  // ---------- positions ----------

  insertPosition(row: CondorPositionRow): number {
    const res = this.db
      .prepare(
        `INSERT INTO condor_position (
          local_id, alpaca_order_id, cycle_month, opened_at, expiration_date, status,
          short_put_strike, long_put_strike, short_call_strike, long_call_strike,
          credit_received, max_loss, contracts, dry_run, closed_at, realized_pnl, exit_reason, notes
        ) VALUES (
          @local_id, @alpaca_order_id, @cycle_month, @opened_at, @expiration_date, @status,
          @short_put_strike, @long_put_strike, @short_call_strike, @long_call_strike,
          @credit_received, @max_loss, @contracts, @dry_run, @closed_at, @realized_pnl, @exit_reason, @notes
        )`,
      )
      .run({
        ...row,
        alpaca_order_id: row.alpaca_order_id ?? null,
        credit_received: row.credit_received ?? null,
        closed_at: row.closed_at ?? null,
        realized_pnl: row.realized_pnl ?? null,
        exit_reason: row.exit_reason ?? null,
        notes: row.notes ?? null,
      });
    return res.lastInsertRowid as number;
  }

  updatePositionStatus(
    id: number,
    status: CondorPositionRow['status'],
    updates: Partial<
      Pick<
        CondorPositionRow,
        | 'closed_at'
        | 'realized_pnl'
        | 'exit_reason'
        | 'credit_received'
        | 'alpaca_order_id'
      >
    > = {},
  ): void {
    this.db
      .prepare(
        `UPDATE condor_position
         SET status = @status,
             closed_at = COALESCE(@closed_at, closed_at),
             realized_pnl = COALESCE(@realized_pnl, realized_pnl),
             exit_reason = COALESCE(@exit_reason, exit_reason),
             credit_received = COALESCE(@credit_received, credit_received),
             alpaca_order_id = COALESCE(@alpaca_order_id, alpaca_order_id)
         WHERE id = @id`,
      )
      .run({
        id,
        status,
        closed_at: updates.closed_at ?? null,
        realized_pnl: updates.realized_pnl ?? null,
        exit_reason: updates.exit_reason ?? null,
        credit_received: updates.credit_received ?? null,
        alpaca_order_id: updates.alpaca_order_id ?? null,
      });
  }

  getPosition(id: number): CondorPositionRow | undefined {
    return this.db
      .prepare('SELECT * FROM condor_position WHERE id = ?')
      .get(id) as CondorPositionRow | undefined;
  }

  listPositions(params: { status?: string } = {}): CondorPositionRow[] {
    if (params.status) {
      return this.db
        .prepare(
          'SELECT * FROM condor_position WHERE status = ? ORDER BY opened_at DESC',
        )
        .all(params.status) as CondorPositionRow[];
    }
    return this.db
      .prepare('SELECT * FROM condor_position ORDER BY opened_at DESC')
      .all() as CondorPositionRow[];
  }

  listOpenPositions(): CondorPositionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM condor_position
         WHERE status IN ('pending','open','closing')
         ORDER BY opened_at`,
      )
      .all() as CondorPositionRow[];
  }

  // ---------- legs ----------

  insertLeg(row: CondorLegRow): number {
    const res = this.db
      .prepare(
        `INSERT INTO condor_leg (
          position_id, side, contract_symbol, strike, expiration,
          alpaca_leg_order_id, fill_price, fill_qty
        ) VALUES (
          @position_id, @side, @contract_symbol, @strike, @expiration,
          @alpaca_leg_order_id, @fill_price, @fill_qty
        )`,
      )
      .run({
        ...row,
        alpaca_leg_order_id: row.alpaca_leg_order_id ?? null,
        fill_price: row.fill_price ?? null,
        fill_qty: row.fill_qty ?? null,
      });
    return res.lastInsertRowid as number;
  }

  listLegsForPosition(positionId: number): CondorLegRow[] {
    return this.db
      .prepare('SELECT * FROM condor_leg WHERE position_id = ? ORDER BY id')
      .all(positionId) as CondorLegRow[];
  }

  // ---------- mark to market ----------

  insertMarkToMarket(row: MarkToMarketRow): void {
    this.db
      .prepare(
        `INSERT INTO mark_to_market (
          position_id, sampled_at, spy_spot, vix, mid_value, unrealized_pnl
        ) VALUES (
          @position_id, @sampled_at, @spy_spot, @vix, @mid_value, @unrealized_pnl
        )`,
      )
      .run(row);
  }

  // ---------- signal samples ----------

  insertSignalSample(row: SignalSampleRow): void {
    this.db
      .prepare(
        `INSERT INTO signal_sample (
          sampled_at, spy_spot, vix, rv30, vrp, regime, entry_eligible
        ) VALUES (
          @sampled_at, @spy_spot, @vix, @rv30, @vrp, @regime, @entry_eligible
        )`,
      )
      .run(row);
  }

  // ---------- entry decisions ----------

  insertEntryDecision(row: EntryDecisionRow): number {
    const res = this.db
      .prepare(
        `INSERT INTO entry_decision (
          cycle_month, decided_at, decision, reason, position_id
        ) VALUES (
          @cycle_month, @decided_at, @decision, @reason, @position_id
        )`,
      )
      .run({
        ...row,
        position_id: row.position_id ?? null,
      });
    return res.lastInsertRowid as number;
  }

  hasDecisionForCycle(cycleMonth: string): boolean {
    const row = this.db
      .prepare(
        'SELECT 1 AS x FROM entry_decision WHERE cycle_month = ? LIMIT 1',
      )
      .get(cycleMonth);
    return !!row;
  }

  // ---------- account snapshots ----------

  insertAccountSnapshot(row: AccountSnapshotRow): void {
    this.db
      .prepare(
        `INSERT INTO account_snapshot (
          sampled_at, cash, equity, buying_power, open_positions
        ) VALUES (
          @sampled_at, @cash, @equity, @buying_power, @open_positions
        )`,
      )
      .run(row);
  }
}
