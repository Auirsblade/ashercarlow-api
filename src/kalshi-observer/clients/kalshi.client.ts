import { Injectable, Logger } from '@nestjs/common';

/**
 * Read-only Kalshi REST client.
 *
 * Phase 1 only calls unauthenticated GET endpoints (verified live 2026-04-07):
 *  - /markets, /events, /series, /markets/{ticker}/orderbook
 *
 * The client will load KALSHI_KEY_ID / KALSHI_PRIVATE_KEY from env and expose
 * a `signRequest` helper for future use, but Phase 1 never invokes it — there
 * is no trade-endpoint code path in this file and no `POST` method.
 *
 * IMPORTANT: Kalshi market responses use `_dollars` and `_fp` field-name
 * suffixes (e.g. `yes_ask_dollars`, `volume_fp`). Older docs showing plain
 * `yes_ask` are out of date.
 */

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

export interface KalshiSeries {
  ticker: string;
  title: string;
  category?: string;
  tags?: string[];
  frequency?: string;
  contract_url?: string;
  settlement_sources?: Array<{ name: string; url?: string }>;
}

export interface KalshiEvent {
  event_ticker: string;
  series_ticker?: string;
  title?: string;
  sub_title?: string;
  category?: string;
}

/**
 * Kalshi market shape (post-2025 field naming).
 * Only fields the observer currently cares about. Everything is optional
 * because Kalshi returns different subsets in different contexts.
 *
 * IMPORTANT: `_dollars` and `_fp` fields come back from Kalshi as *strings*
 * (e.g. `"0.0600"`, `"796.00"`), not numbers. Verified live against the
 * production API. Use `parseKalshiNumber()` to coerce.
 *
 * CRITICAL: The ticker suffix (e.g. `-T48`, `-B50.5`) is NOT semantic. A
 * `-T48` ticker can be either "> 48" or "< 48" depending on `strike_type`.
 * Always use `strike_type` + `floor_strike` / `cap_strike` as ground truth.
 */
export interface KalshiMarket {
  ticker: string;
  event_ticker?: string;
  series_ticker?: string;
  title?: string;
  subtitle?: string;
  rules_primary?: string;
  rules_secondary?: string;
  status?: string;
  /** `greater`, `less`, `between`, `structured` */
  strike_type?: string;
  floor_strike?: number | null;
  cap_strike?: number | null;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  no_ask_dollars?: string;
  no_bid_dollars?: string;
  last_price_dollars?: string;
  yes_ask_size_fp?: string;
  yes_bid_size_fp?: string;
  volume_fp?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  /** Kalshi returns this as a dollar-formatted string, field name is
   *  `liquidity_dollars` (NOT `liquidity_fp` — that was the old naming). */
  liquidity_dollars?: string;
  expected_expiration_time?: string;
  latest_expiration_time?: string;
  early_close_condition?: string;
  /** Populated on settled/finalized markets. One of `yes`, `no`, `void`, or `""` for active. */
  result?: string;
  /** Kalshi's authoritative underlying value used for settlement (string, may be empty). */
  expiration_value?: string;
}

export interface KalshiOrderbook {
  orderbook_fp?: {
    yes_dollars?: Array<[string, string]>;
    no_dollars?: Array<[string, string]>;
  };
}

/**
 * Parse a `_dollars` or `_fp` field from Kalshi responses.
 * Returns `undefined` for missing/null/unparseable values.
 */
export function parseKalshiNumber(
  value: string | number | undefined | null,
): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

interface FetchOptions {
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

@Injectable()
export class KalshiClient {
  private readonly logger = new Logger(KalshiClient.name);
  private readonly keyId = process.env.KALSHI_KEY_ID;
  private readonly privateKey = process.env.KALSHI_PRIVATE_KEY;

  constructor() {
    if (this.keyId || this.privateKey) {
      this.logger.log(
        'Kalshi credentials loaded (read-only; no trade endpoints are called in Phase 1)',
      );
    } else {
      this.logger.log(
        'Kalshi credentials not set; running unauthenticated (fine for Phase 1 reads)',
      );
    }
  }

  async listSeries(
    params: {
      category?: string;
      tags?: string[];
      limit?: number;
    } = {},
  ): Promise<KalshiSeries[]> {
    const res = await this.fetchJson<{ series: KalshiSeries[] }>('/series', {
      query: { limit: params.limit ?? 500 },
    });
    let list = res.series ?? [];
    if (params.category) {
      list = list.filter((s) => s.category === params.category);
    }
    if (params.tags && params.tags.length) {
      const wanted = new Set(params.tags);
      list = list.filter((s) => (s.tags ?? []).some((t) => wanted.has(t)));
    }
    return list;
  }

  async getSeries(ticker: string): Promise<KalshiSeries> {
    const res = await this.fetchJson<{ series: KalshiSeries }>(
      `/series/${encodeURIComponent(ticker)}`,
    );
    return res.series;
  }

  async listEvents(params: {
    series_ticker?: string;
    status?: 'open' | 'closed' | 'settled';
    limit?: number;
  }): Promise<KalshiEvent[]> {
    const res = await this.fetchJson<{ events: KalshiEvent[] }>('/events', {
      query: {
        series_ticker: params.series_ticker,
        status: params.status,
        limit: params.limit ?? 100,
      },
    });
    return res.events ?? [];
  }

  async listMarkets(params: {
    event_ticker?: string;
    series_ticker?: string;
    status?: string;
    limit?: number;
  }): Promise<KalshiMarket[]> {
    const res = await this.fetchJson<{ markets: KalshiMarket[] }>('/markets', {
      query: {
        event_ticker: params.event_ticker,
        series_ticker: params.series_ticker,
        status: params.status,
        limit: params.limit ?? 200,
      },
    });
    return res.markets ?? [];
  }

  async getMarket(ticker: string): Promise<KalshiMarket> {
    const res = await this.fetchJson<{ market: KalshiMarket }>(
      `/markets/${encodeURIComponent(ticker)}`,
    );
    return res.market;
  }

  async getOrderbook(ticker: string): Promise<KalshiOrderbook> {
    return this.fetchJson<KalshiOrderbook>(
      `/markets/${encodeURIComponent(ticker)}/orderbook`,
    );
  }

  /**
   * RSA-PSS request signing helper. Not called in Phase 1. Present so we don't
   * have to rewrite the client in Phase 2. If this is ever invoked in Phase 1,
   * that's a bug — Phase 1 is read-only and all reads are unauthenticated.
   */
  signRequest(method: string, path: string, timestampMs: number): string {
    throw new Error(
      `KalshiClient.signRequest(${method} ${path} @${timestampMs}) is not ` +
        'available in Phase 1. Trading code lives in Phase 2. If you hit ' +
        'this, you are calling a private endpoint from the observer by mistake.',
    );
  }

  private async fetchJson<T>(
    path: string,
    opts: FetchOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const started = Date.now();

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: opts.signal,
        });

        if (res.status === 429) {
          const backoffMs = 500 * Math.pow(2, attempt);
          this.logger.warn(
            `Kalshi 429 on ${path}, backing off ${backoffMs}ms (attempt ${attempt + 1})`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        if (!res.ok) {
          const body = await res.text();
          throw new Error(
            `Kalshi ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 200)}`,
          );
        }

        const json = (await res.json()) as T;
        this.logger.debug(
          `GET ${path} -> ${res.status} in ${Date.now() - started}ms`,
        );
        return json;
      } catch (err) {
        lastErr = err;
        if (attempt === 2) break;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(`${KALSHI_BASE_URL}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url.toString();
  }
}
