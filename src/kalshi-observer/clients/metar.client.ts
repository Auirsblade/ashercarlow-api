import { Injectable, Logger } from '@nestjs/common';

/**
 * NOAA Aviation Weather Center METAR/TAF client.
 * https://aviationweather.gov/api/data/metar — JSON, no auth.
 *
 * METAR/TAF is a real-time *leading indicator* for Kalshi weather markets.
 * The authoritative resolution source is the NWS Daily Climate Report (CLI),
 * not METAR — see nws.client.ts. Use METAR for nowcasting and live edge
 * detection during the day, not for resolution confirmation.
 */

const METAR_BASE_URL = 'https://aviationweather.gov/api/data';

export interface MetarObservation {
  icaoId: string;
  receiptTime?: string;
  obsTime?: number;
  reportTime?: string;
  temp?: number; // Celsius
  dewp?: number;
  wdir?: number | string;
  wspd?: number; // knots
  wgst?: number | null;
  visib?: number | string;
  altim?: number;
  slp?: number;
  wxString?: string | null;
  clouds?: Array<{ cover: string; base?: number }>;
  rawOb?: string;
}

export interface TafForecast {
  icaoId: string;
  issueTime?: string;
  validTimeFrom?: number;
  validTimeTo?: number;
  rawTAF?: string;
  fcsts?: Array<{
    timeFrom?: number;
    timeTo?: number;
    temp?: number;
    wspd?: number;
    wgst?: number;
    visib?: number | string;
    wxString?: string;
  }>;
}

@Injectable()
export class MetarClient {
  private readonly logger = new Logger(MetarClient.name);

  /**
   * Fetch latest METAR observations for one or more ICAO stations.
   * Returns raw NOAA JSON — temperature is in Celsius.
   */
  async getMetar(icaos: string[], hours = 1): Promise<MetarObservation[]> {
    if (icaos.length === 0) return [];
    const url = new URL(`${METAR_BASE_URL}/metar`);
    url.searchParams.set('ids', icaos.join(','));
    url.searchParams.set('format', 'json');
    url.searchParams.set('hours', String(hours));

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        `METAR ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    return (await res.json()) as MetarObservation[];
  }

  /**
   * Fetch the latest TAF forecast for one or more ICAO stations.
   */
  async getTaf(icaos: string[]): Promise<TafForecast[]> {
    if (icaos.length === 0) return [];
    const url = new URL(`${METAR_BASE_URL}/taf`);
    url.searchParams.set('ids', icaos.join(','));
    url.searchParams.set('format', 'json');

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        `TAF ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    return (await res.json()) as TafForecast[];
  }

  /**
   * Convenience: get the most recent METAR observation per station.
   * Returns a map keyed by ICAO, undefined if no data.
   */
  async getLatestByStation(
    icaos: string[],
  ): Promise<Map<string, MetarObservation | undefined>> {
    const obs = await this.getMetar(icaos, 1);
    const map = new Map<string, MetarObservation | undefined>();
    for (const icao of icaos) map.set(icao, undefined);
    for (const o of obs) {
      const existing = map.get(o.icaoId);
      if (!existing || (o.obsTime ?? 0) > (existing.obsTime ?? 0)) {
        map.set(o.icaoId, o);
      }
    }
    return map;
  }

  static celsiusToFahrenheit(c: number): number {
    return (c * 9) / 5 + 32;
  }
}
