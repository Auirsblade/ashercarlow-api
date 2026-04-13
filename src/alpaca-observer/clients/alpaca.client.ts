import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * Read + write Alpaca paper trading client.
 *
 * SAFETY: this client refuses to construct against the live trading base
 * URL. The kill switch is enforced at the HTTP boundary because Alpaca's
 * `/account` response does NOT include a paper-vs-live discriminator
 * field — there is no runtime check we can do after the fact.
 *
 * IMPORTANT field-name traps verified live during Step 0:
 *   - Greeks are camelCase (`impliedVolatility`, `delta`, etc.) while most
 *     other Alpaca fields are snake_case.
 *   - Credit spreads use NEGATIVE `limit_price` strings (e.g. `"-1.80"`
 *     for an iron condor sold for $1.80 credit).
 *   - 0DTE options have no greeks at all (Black-Scholes degeneracy at T=0).
 *     We don't trade 0DTE so this is informational.
 *   - Account response has no paper/live discriminator. Trust the base URL.
 */

const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets';

/**
 * Hostnames that are NEVER allowed for the trading base URL. The live
 * trading host is exact-matched on hostname (not substring) because
 * the paper hostname `paper-api.alpaca.markets` would otherwise
 * incorrectly fail a substring check against `api.alpaca.markets`.
 */
const FORBIDDEN_TRADE_HOSTNAMES = new Set(['api.alpaca.markets']);

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  cash: string;
  equity: string;
  buying_power: string;
  options_buying_power?: string;
  options_approved_level?: number;
  pattern_day_trader?: boolean;
}

export interface AlpacaOptionGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
}

export interface AlpacaOptionSnapshot {
  symbol: string;
  /** ISO date e.g. "2026-05-15" */
  expirationDate: string;
  strikePrice: number;
  type: 'call' | 'put';
  /** camelCase, NOT snake_case — verified live in Step 0 */
  impliedVolatility?: number;
  greeks?: AlpacaOptionGreeks;
  latestQuote?: {
    bid: number;
    ask: number;
    bidSize?: number;
    askSize?: number;
    timestamp?: string;
  };
  latestTrade?: {
    price: number;
    size?: number;
    timestamp?: string;
  };
}

export interface AlpacaPosition {
  symbol: string;
  asset_id: string;
  qty: string;
  side: 'long' | 'short';
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  asset_class: string;
}

/**
 * Multi-leg order leg.
 *
 * For an iron condor we send 4 legs:
 *   short put  side=sell ratio_qty=1 (lower-strike sold)
 *   long  put  side=buy  ratio_qty=1 (further-OTM put bought as wing)
 *   short call side=sell ratio_qty=1
 *   long  call side=buy  ratio_qty=1
 *
 * The parent order has `order_class: "mleg"` and a single `limit_price`.
 * For a NET CREDIT iron condor, `limit_price` is NEGATIVE (e.g. "-1.80").
 */
export interface AlpacaMlegLeg {
  symbol: string;
  ratio_qty: string;
  side: 'buy' | 'sell';
  position_intent?: 'opening' | 'closing';
}

export interface AlpacaMlegOrderRequest {
  order_class: 'mleg';
  qty: string;
  type: 'limit';
  time_in_force: 'day' | 'gtc';
  /** Negative for net credit, positive for net debit. String. */
  limit_price: string;
  legs: AlpacaMlegLeg[];
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  status: string;
  symbol?: string;
  qty: string;
  filled_qty: string;
  order_class: string;
  legs?: AlpacaOrder[];
  filled_avg_price?: string;
  submitted_at: string;
  filled_at?: string;
  canceled_at?: string;
}

@Injectable()
export class AlpacaClient implements OnModuleInit {
  private readonly logger = new Logger(AlpacaClient.name);

  private readonly baseUrl: string;
  private readonly dataUrl = DATA_BASE_URL;
  private readonly keyId = process.env.ALPACA_API_KEY_ID;
  private readonly secret = process.env.ALPACA_API_SECRET_KEY;

  constructor() {
    const configured = process.env.ALPACA_BASE_URL ?? PAPER_BASE_URL;
    // Hard refusal to instantiate against the live URL. The kill switch
    // is at construction time because there is no runtime discriminator
    // we can check on the account response. Exact hostname match — substring
    // checks would falsely flag `paper-api.alpaca.markets`.
    let hostname: string;
    try {
      hostname = new URL(configured).hostname;
    } catch {
      throw new Error(
        `AlpacaClient refused to construct: ALPACA_BASE_URL "${configured}" is not a valid URL`,
      );
    }
    if (FORBIDDEN_TRADE_HOSTNAMES.has(hostname)) {
      throw new Error(
        `AlpacaClient refused to construct: ALPACA_BASE_URL "${configured}" ` +
          `points at the live trading endpoint (${hostname}). Phase 1 is paper-only. ` +
          `Set ALPACA_BASE_URL=${PAPER_BASE_URL} or unset it (defaults to paper).`,
      );
    }
    this.baseUrl = configured;
  }

  onModuleInit() {
    if (this.keyId && this.secret) {
      this.logger.log(
        `AlpacaClient configured for PAPER (${this.baseUrl}); credentials loaded`,
      );
    } else {
      this.logger.warn(
        'AlpacaClient configured for PAPER but credentials are NOT set. ' +
          'API calls will fail until ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY are populated.',
      );
    }
  }

  // ---------- account ----------

  async getAccount(): Promise<AlpacaAccount> {
    return this.fetchTrade<AlpacaAccount>('GET', '/v2/account');
  }

  // ---------- options chain ----------

  /**
   * Fetch options snapshots (chain with greeks + quotes) for an underlying.
   * Returns an array of contract snapshots filtered by expiration if given.
   *
   * Endpoint: GET /v1beta1/options/snapshots/{underlying}
   * Verified live in Step 0; field names are camelCase.
   */
  async getOptionChain(
    underlying: string,
    params: {
      expirationDate?: string;
      strikePriceGte?: number;
      strikePriceLte?: number;
      type?: 'call' | 'put';
      feed?: 'indicative' | 'opra';
    } = {},
  ): Promise<AlpacaOptionSnapshot[]> {
    const query = new URLSearchParams();
    if (params.expirationDate)
      query.set('expiration_date', params.expirationDate);
    if (params.strikePriceGte != null)
      query.set('strike_price_gte', String(params.strikePriceGte));
    if (params.strikePriceLte != null)
      query.set('strike_price_lte', String(params.strikePriceLte));
    if (params.type) query.set('type', params.type);
    query.set('feed', params.feed ?? 'indicative');

    const url = `${this.dataUrl}/v1beta1/options/snapshots/${encodeURIComponent(underlying)}?${query.toString()}`;
    const json = await this.fetchAuthed<{
      snapshots?: Record<string, unknown>;
      next_page_token?: string;
    }>(url);

    // Response shape: { snapshots: { "SPY260515P00580000": {...}, ... } }
    // We normalize into an array of typed snapshots.
    const out: AlpacaOptionSnapshot[] = [];
    const snapshots = (json.snapshots ?? {}) as Record<string, RawSnapshot>;
    for (const [symbol, raw] of Object.entries(snapshots)) {
      const parsed = this.parseSnapshot(symbol, raw);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  // ---------- orders ----------

  /**
   * Place a multi-leg order. For iron condors, `order_class` MUST be "mleg"
   * and `limit_price` is NEGATIVE for net credit (e.g. "-1.80").
   *
   * The Alpaca API treats this as a single atomic order — partial fills
   * are handled at the parent level, never leaving us with directional risk
   * from a partially-filled spread.
   */
  async placeMlegOrder(req: AlpacaMlegOrderRequest): Promise<AlpacaOrder> {
    return this.fetchTrade<AlpacaOrder>('POST', '/v2/orders', req);
  }

  async getOrder(id: string): Promise<AlpacaOrder> {
    return this.fetchTrade<AlpacaOrder>(
      'GET',
      `/v2/orders/${encodeURIComponent(id)}`,
    );
  }

  async cancelOrder(id: string): Promise<void> {
    await this.fetchTrade<void>(
      'DELETE',
      `/v2/orders/${encodeURIComponent(id)}`,
    );
  }

  // ---------- positions ----------

  async listPositions(): Promise<AlpacaPosition[]> {
    return this.fetchTrade<AlpacaPosition[]>('GET', '/v2/positions');
  }

  // ---------- stock bars (data API) ----------

  /**
   * Fetch daily bars for an equity. Used by SignalService to compute the
   * 30-day realized vol of SPY.
   *
   * Endpoint: GET https://data.alpaca.markets/v2/stocks/{symbol}/bars
   * Free tier returns 15-min delayed data which is fine for end-of-day signals.
   */
  async getStockBars(
    symbol: string,
    params: {
      timeframe?: string; // e.g. '1Day'
      start?: string; // ISO date
      end?: string; // ISO date
      limit?: number;
      feed?: 'iex' | 'sip';
    } = {},
  ): Promise<StockBar[]> {
    const query = new URLSearchParams();
    query.set('timeframe', params.timeframe ?? '1Day');
    if (params.start) query.set('start', params.start);
    if (params.end) query.set('end', params.end);
    query.set('limit', String(params.limit ?? 60));
    query.set('feed', params.feed ?? 'iex');
    query.set('adjustment', 'raw');

    const url = `${this.dataUrl}/v2/stocks/${encodeURIComponent(symbol)}/bars?${query.toString()}`;
    const json = await this.fetchAuthed<{ bars?: RawStockBar[] }>(url);
    return (json.bars ?? []).map((b) => ({
      symbol,
      timestamp: b.t,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    }));
  }

  // ---------- internal ----------

  private parseSnapshot(
    symbol: string,
    raw: RawSnapshot,
  ): AlpacaOptionSnapshot | null {
    const parsed = parseOccSymbol(symbol);
    if (!parsed) return null;
    return {
      symbol,
      expirationDate: parsed.expirationDate,
      strikePrice: parsed.strikePrice,
      type: parsed.type,
      impliedVolatility: raw.impliedVolatility,
      greeks: raw.greeks,
      latestQuote: raw.latestQuote
        ? {
            bid: raw.latestQuote.bp ?? raw.latestQuote.bid ?? 0,
            ask: raw.latestQuote.ap ?? raw.latestQuote.ask ?? 0,
            bidSize: raw.latestQuote.bs ?? raw.latestQuote.bidSize,
            askSize: raw.latestQuote.as ?? raw.latestQuote.askSize,
            timestamp: raw.latestQuote.t ?? raw.latestQuote.timestamp,
          }
        : undefined,
      latestTrade: raw.latestTrade
        ? {
            price: raw.latestTrade.p ?? raw.latestTrade.price ?? 0,
            size: raw.latestTrade.s ?? raw.latestTrade.size,
            timestamp: raw.latestTrade.t ?? raw.latestTrade.timestamp,
          }
        : undefined,
    };
  }

  private async fetchTrade<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.fetchAuthed<T>(`${this.baseUrl}${path}`, { method, body });
  }

  private async fetchAuthed<T>(
    url: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    if (!this.keyId || !this.secret) {
      throw new Error(
        'Alpaca credentials not configured: set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY',
      );
    }
    const headers: Record<string, string> = {
      'APCA-API-KEY-ID': this.keyId,
      'APCA-API-SECRET-KEY': this.secret,
      Accept: 'application/json',
    };
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, init);
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Alpaca ${res.status} ${res.statusText} on ${url}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  }
}

// ---------- types ----------

export interface StockBar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawStockBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// ---------- helpers ----------

interface RawSnapshot {
  impliedVolatility?: number;
  greeks?: AlpacaOptionGreeks;
  latestQuote?: {
    bp?: number;
    ap?: number;
    bid?: number;
    ask?: number;
    bs?: number;
    as?: number;
    bidSize?: number;
    askSize?: number;
    t?: string;
    timestamp?: string;
  };
  latestTrade?: {
    p?: number;
    price?: number;
    s?: number;
    size?: number;
    t?: string;
    timestamp?: string;
  };
}

/**
 * Parse an OCC option symbol like `SPY260515C00580000` into its components.
 * Format: <root><yymmdd><C|P><strike * 1000, padded to 8 digits>
 * Returns null on parse failure.
 */
export function parseOccSymbol(symbol: string): {
  underlying: string;
  expirationDate: string;
  type: 'call' | 'put';
  strikePrice: number;
} | null {
  const m = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, yymmdd, cp, strikeRaw] = m;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  const year = 2000 + yy;
  const expirationDate = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const strikePrice = parseInt(strikeRaw, 10) / 1000;
  return {
    underlying,
    expirationDate,
    type: cp === 'C' ? 'call' : 'put',
    strikePrice,
  };
}

/**
 * Build an OCC option symbol from its components.
 */
export function buildOccSymbol(
  underlying: string,
  expirationDate: string,
  type: 'call' | 'put',
  strikePrice: number,
): string {
  const [year, month, day] = expirationDate
    .split('-')
    .map((x) => parseInt(x, 10));
  const yy = String(year - 2000).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const cp = type === 'call' ? 'C' : 'P';
  const strikeRaw = String(Math.round(strikePrice * 1000)).padStart(8, '0');
  return `${underlying}${yy}${mm}${dd}${cp}${strikeRaw}`;
}
