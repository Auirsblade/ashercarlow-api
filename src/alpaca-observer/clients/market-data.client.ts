import { Injectable, Logger } from '@nestjs/common';

/**
 * Free market data sources for VIX (and any other index data Alpaca doesn't
 * carry). VIX is a CBOE-calculated index, not a tradable equity, so it
 * doesn't appear in Alpaca's stock bars endpoint.
 *
 * Primary source: Yahoo Finance chart JSON
 *   `https://query1.finance.yahoo.com/v7/finance/chart/^VIX?interval=1d&range=2mo`
 *   - free, no auth required (verified live 2026-04-07)
 *   - end-of-day data with the most recent close included
 *   - returns JSON with `chart.result[0].timestamp` + `indicators.quote[0].close`
 *
 * Stooq was the original primary source but it now returns a "contact us"
 * message instead of CSV (anti-scraping). The legacy CSV parser is preserved
 * below as `parseStooqCsv` for unit tests / future fallback if Stooq ever
 * relaxes its policy.
 *
 * Yahoo's `/v7/finance/download/` CSV endpoint is auth-walled as of 2025-2026
 * (returns 401). Only the `/chart/` JSON endpoint is publicly accessible.
 */

const YAHOO_VIX_URL =
  'https://query1.finance.yahoo.com/v7/finance/chart/%5EVIX?interval=1d&range=2mo';
const YAHOO_USER_AGENT =
  'Mozilla/5.0 (compatible; ashercarlow-api alpaca-observer)';

export interface VixDailyBar {
  date: string; // YYYY-MM-DD (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

@Injectable()
export class MarketDataClient {
  private readonly logger = new Logger(MarketDataClient.name);

  /**
   * Fetch recent VIX daily bars from Yahoo Finance. Returns rows in
   * chronological order (oldest first).
   */
  async getVixHistory(): Promise<VixDailyBar[]> {
    const res = await fetch(YAHOO_VIX_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': YAHOO_USER_AGENT,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Yahoo VIX fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    const json = (await res.json()) as YahooChartResponse;
    return this.parseYahooChart(json);
  }

  /**
   * Convenience: most recent VIX close, or null if the feed returned empty.
   */
  async getLatestVix(): Promise<{ date: string; close: number } | null> {
    const history = await this.getVixHistory();
    if (history.length === 0) return null;
    const latest = history[history.length - 1];
    return { date: latest.date, close: latest.close };
  }

  parseYahooChart(json: YahooChartResponse): VixDailyBar[] {
    if (json.chart?.error) {
      this.logger.warn(
        `Yahoo chart returned error: ${json.chart.error.description}`,
      );
      return [];
    }
    const result = json.chart?.result?.[0];
    if (!result?.timestamp || !result.indicators?.quote?.[0]) return [];
    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const out: VixDailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = q.close?.[i];
      if (close == null || !Number.isFinite(close)) continue;
      const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
      out.push({
        date,
        open: q.open?.[i] ?? close,
        high: q.high?.[i] ?? close,
        low: q.low?.[i] ?? close,
        close,
      });
    }
    return out;
  }

  /**
   * Legacy Stooq CSV parser. Stooq blocks our user-agent as of 2026 but the
   * parser is preserved for unit tests and future fallback use.
   */
  parseStooqCsv(text: string): VixDailyBar[] {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase().split(',');
    const idx = {
      date: header.indexOf('date'),
      open: header.indexOf('open'),
      high: header.indexOf('high'),
      low: header.indexOf('low'),
      close: header.indexOf('close'),
    };
    if (idx.date < 0 || idx.close < 0) {
      this.logger.warn(
        `Stooq CSV header missing expected columns: ${lines[0]}`,
      );
      return [];
    }
    const out: VixDailyBar[] = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      if (cols.length < Math.max(idx.date, idx.close) + 1) continue;
      const date = cols[idx.date];
      const open = parseFloat(cols[idx.open] ?? '');
      const high = parseFloat(cols[idx.high] ?? '');
      const low = parseFloat(cols[idx.low] ?? '');
      const close = parseFloat(cols[idx.close]);
      if (!date || !Number.isFinite(close)) continue;
      out.push({
        date,
        open: Number.isFinite(open) ? open : close,
        high: Number.isFinite(high) ? high : close,
        low: Number.isFinite(low) ? low : close,
        close,
      });
    }
    return out;
  }
}
