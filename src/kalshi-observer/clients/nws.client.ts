import { Injectable, Logger } from '@nestjs/common';

/**
 * NWS (api.weather.gov) client.
 *
 * The AUTHORITATIVE resolution source for Kalshi weather markets is the
 * NWS Daily Climate Report (CLI) — a text product published once per day by
 * the local Weather Forecast Office (WFO). This client fetches and parses
 * those CLIs, plus the standard observation/forecast endpoints.
 *
 * Endpoints (no auth, attribution required via User-Agent):
 *   /products/types/CLI/locations/{locationId}   -> list of recent CLI products
 *   /products/{productId}                        -> full text of a product
 *   /stations/{stationId}/observations/latest    -> current obs
 *   /points/{lat},{lon}                          -> forecast grid lookup
 */

const NWS_BASE_URL = 'https://api.weather.gov';
const USER_AGENT = 'ashercarlow-api kalshi-observer (contact: via repo)';
const MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

export interface NwsProductRef {
  '@id'?: string;
  id: string;
  issuanceTime: string;
  productCode: string;
  productName?: string;
  issuingOffice?: string;
}

export interface NwsProduct {
  id: string;
  issuanceTime: string;
  productCode: string;
  issuingOffice: string;
  productText: string;
}

export interface NwsObservation {
  stationId: string;
  timestamp: string;
  temperatureC?: number;
  dewpointC?: number;
  windSpeedKt?: number;
  precipitationLast1hMm?: number;
  raw: unknown;
}

/**
 * Parsed fields from an NWS CLI text product.
 * This is the binding resolution data for daily high/low/precip markets.
 */
export interface ParsedCli {
  issuanceTime: string;
  productId: string;
  issuingOffice: string;
  /** Observation date the CLI covers, e.g. "2026-04-07" (best-effort parse). */
  observationDate?: string;
  /** Maximum temperature in whole degrees Fahrenheit, or undefined if not parseable. */
  maxTempF?: number;
  /** Minimum temperature in whole degrees Fahrenheit. */
  minTempF?: number;
  /** Daily total precipitation in inches. Trace is parsed as `null`, not 0. */
  precipIn?: number | null;
  /** True if precip was reported as "T" (trace). Trace is NOT > 0 per NWS convention. */
  precipIsTrace?: boolean;
  rawText: string;
}

@Injectable()
export class NwsClient {
  private readonly logger = new Logger(NwsClient.name);

  /**
   * Fetch the latest CLI product for a given location ID.
   * `locationId` is the 3-letter NWS location code (e.g. "NYC", "LAX", "MDW").
   * Note: this is different from the ICAO (KNYC) and from the WFO (OKX).
   */
  async getLatestCli(locationId: string): Promise<ParsedCli | null> {
    const listUrl = `${NWS_BASE_URL}/products/types/CLI/locations/${encodeURIComponent(locationId)}`;
    const listRes = await this.fetchJson<{ '@graph': NwsProductRef[] }>(
      listUrl,
    );
    const list = listRes['@graph'] ?? [];
    if (list.length === 0) {
      this.logger.warn(`No CLI products found for location ${locationId}`);
      return null;
    }

    // List is ordered newest-first.
    const latest = list[0];
    const product = await this.getProduct(latest.id);
    return this.parseCli(product);
  }

  async getProduct(productId: string): Promise<NwsProduct> {
    return this.fetchJson<NwsProduct>(`${NWS_BASE_URL}/products/${productId}`);
  }

  async getLatestObservation(stationId: string): Promise<NwsObservation> {
    const url = `${NWS_BASE_URL}/stations/${encodeURIComponent(stationId)}/observations/latest`;
    const raw = await this.fetchJson<{
      properties: {
        timestamp: string;
        temperature?: { value: number | null };
        dewpoint?: { value: number | null };
        windSpeed?: { value: number | null };
        precipitationLastHour?: { value: number | null };
      };
    }>(url);

    return {
      stationId,
      timestamp: raw.properties.timestamp,
      temperatureC: raw.properties.temperature?.value ?? undefined,
      dewpointC: raw.properties.dewpoint?.value ?? undefined,
      windSpeedKt:
        raw.properties.windSpeed?.value != null
          ? raw.properties.windSpeed.value * 0.539957
          : undefined,
      precipitationLast1hMm:
        raw.properties.precipitationLastHour?.value ?? undefined,
      raw,
    };
  }

  /**
   * Parse a CLI text product into structured fields.
   *
   * CLI format (excerpt):
   *
   *   CLIMATE REPORT
   *   NATIONAL WEATHER SERVICE NEW YORK NY
   *   ...
   *   ................................
   *   .....TEMPERATURE (F)..........
   *   ................................
   *   MAXIMUM         57R  324 PM  ...
   *   MINIMUM         39   558 AM  ...
   *   ...
   *   PRECIPITATION (IN)
   *   YESTERDAY       0.02   ...
   *
   * This parser is best-effort and pulls out the Observed/Yesterday values.
   * Tune aggressively after the first real CLIs are observed in production.
   */
  parseCli(product: NwsProduct): ParsedCli {
    const text = product.productText ?? '';
    const out: ParsedCli = {
      issuanceTime: product.issuanceTime,
      productId: product.id,
      issuingOffice: product.issuingOffice,
      rawText: text,
    };

    // Observation date: CLI has "CLIMATE SUMMARY FOR MONTH DD YYYY" lines.
    // Emit as YYYY-MM-DD with NUMERIC month so it matches the market day format.
    const dateMatch = text.match(
      /CLIMATE SUMMARY FOR\s+([A-Z]+)\s+(\d+)\s+(\d{4})/i,
    );
    if (dateMatch) {
      const monthIdx = MONTH_NAMES.indexOf(dateMatch[1].toUpperCase());
      if (monthIdx >= 0) {
        const mm = String(monthIdx + 1).padStart(2, '0');
        const dd = String(parseInt(dateMatch[2], 10)).padStart(2, '0');
        out.observationDate = `${dateMatch[3]}-${mm}-${dd}`;
      }
    }

    // MAXIMUM temperature line. The "Observed" value is the first number after MAXIMUM.
    const maxMatch = text.match(/^\s*MAXIMUM\s+(-?\d+)/m);
    if (maxMatch) out.maxTempF = parseInt(maxMatch[1], 10);

    const minMatch = text.match(/^\s*MINIMUM\s+(-?\d+)/m);
    if (minMatch) out.minTempF = parseInt(minMatch[1], 10);

    // Precipitation. CLI has a PRECIPITATION section with a "YESTERDAY" or
    // "TODAY" row. Trace reports as the literal letter "T".
    const precipMatch = text.match(
      /^\s*(?:YESTERDAY|TODAY)\s+(T|MM|-?\d*\.?\d+)/m,
    );
    if (precipMatch) {
      const token = precipMatch[1];
      if (token === 'T') {
        out.precipIn = null;
        out.precipIsTrace = true;
      } else if (token === 'MM') {
        out.precipIn = undefined;
      } else {
        out.precipIn = parseFloat(token);
        out.precipIsTrace = false;
      }
    }

    return out;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/ld+json, application/json',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      throw new Error(
        `NWS ${res.status} ${res.statusText} on ${url}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }
}
