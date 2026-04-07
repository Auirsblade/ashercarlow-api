import { Injectable, Logger } from '@nestjs/common';

/**
 * FAA NAS Status client.
 *
 * https://nasstatus.faa.gov/api/airport-events — undocumented JSON, no auth.
 * Returns current ground stops, GDPs, AFPs, closures, and departure/arrival
 * delays per airport.
 *
 * In Phase 1 this is a bonus corroborating signal for severe weather (rain,
 * wind, snow) markets: if the FAA has a weather-driven GDP at KMDW or a
 * deicing program at KBOS, that's supporting evidence for the weather signal.
 */

const FAA_BASE_URL = 'https://nasstatus.faa.gov/api';

export interface FaaGroundDelay {
  id?: string;
  airportId: string;
  impactingCondition?: string;
  avgDelay?: number;
  maxDelay?: number;
  startTime?: string;
  endTime?: string;
  center?: string;
  fadtParamType?: string;
}

export interface FaaAirportEvent {
  airportId: string;
  airportLongName?: string;
  latitude?: string;
  longitude?: string;
  groundStop?: unknown;
  groundDelay?: FaaGroundDelay | null;
  airportClosure?: unknown;
  freeForm?: unknown;
  arrivalDelay?: unknown;
  departureDelay?: unknown;
  deicing?: unknown;
  airportConfig?: {
    arrivalRunwayConfig?: string;
    departureRunwayConfig?: string;
    arrivalRate?: number;
  };
}

@Injectable()
export class FaaNasStatusClient {
  private readonly logger = new Logger(FaaNasStatusClient.name);

  async getAirportEvents(): Promise<FaaAirportEvent[]> {
    const res = await fetch(`${FAA_BASE_URL}/airport-events`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ashercarlow-api kalshi-observer',
      },
    });
    if (!res.ok) {
      throw new Error(
        `FAA NAS ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    return (await res.json()) as FaaAirportEvent[];
  }

  /**
   * Return a filtered list for only the airports we care about, keyed by IATA.
   */
  async getEventsForAirports(
    iataCodes: string[],
  ): Promise<Map<string, FaaAirportEvent>> {
    const all = await this.getAirportEvents();
    const wanted = new Set(iataCodes.map((c) => c.toUpperCase()));
    const out = new Map<string, FaaAirportEvent>();
    for (const ev of all) {
      if (wanted.has(ev.airportId)) out.set(ev.airportId, ev);
    }
    return out;
  }
}
