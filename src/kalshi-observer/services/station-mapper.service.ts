import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface StationConfig {
  city: string;
  nws_wfo: string;
  nws_cli_location_id: string;
  primary_station: {
    name: string;
    icao: string;
    lat: number;
    lon: number;
    elevation_m: number;
  };
  divergence_notes: string;
}

/**
 * Maps Kalshi market regions to authoritative weather station metadata.
 *
 * The source of truth is `config/station-map.json`, which encodes the
 * hard-earned lessons from Step 0 research — most importantly:
 *  - Chicago resolves on KMDW (Midway), NOT KORD
 *  - LA resolves on KLAX (airport), NOT KCQT (downtown)
 *  - DC resolves on KDCA (Reagan), NOT KIAD (Dulles)
 *
 * This service will refuse to serve a region it doesn't know and will
 * reject any ICAO that doesn't match the expected primary station for
 * its region. Getting station mapping wrong silently is the single
 * biggest foot-gun for Phase 1.
 */
@Injectable()
export class StationMapperService {
  private readonly logger = new Logger(StationMapperService.name);
  private readonly map: Record<string, StationConfig>;

  constructor() {
    const configPath = path.resolve(
      __dirname,
      '..',
      'config',
      'station-map.json',
    );
    const raw = fs.readFileSync(configPath, 'utf8');
    this.map = JSON.parse(raw) as Record<string, StationConfig>;
    this.logger.log(
      `Loaded ${Object.keys(this.map).length} station mappings: ${Object.keys(this.map).join(', ')}`,
    );
  }

  getRegion(region: string): StationConfig {
    const cfg = this.map[region];
    if (!cfg) {
      throw new Error(
        `Unknown region "${region}". Known regions: ${Object.keys(this.map).join(', ')}`,
      );
    }
    return cfg;
  }

  listRegions(): string[] {
    return Object.keys(this.map);
  }

  /**
   * Returns every unique METAR ICAO in the station map — useful for the
   * sampling loop when fetching METAR in bulk.
   */
  listAllIcaos(): string[] {
    const set = new Set<string>();
    for (const cfg of Object.values(this.map)) {
      set.add(cfg.primary_station.icao);
    }
    return Array.from(set).sort();
  }

  listAllCliLocations(): Array<{ locationId: string; wfo: string }> {
    const seen = new Set<string>();
    const out: Array<{ locationId: string; wfo: string }> = [];
    for (const cfg of Object.values(this.map)) {
      const key = `${cfg.nws_wfo}:${cfg.nws_cli_location_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          locationId: cfg.nws_cli_location_id,
          wfo: cfg.nws_wfo,
        });
      }
    }
    return out;
  }

  /**
   * Hard guard: throw if the caller tries to use an ICAO that doesn't match
   * the region's primary station. Prevents the "Chicago = KORD" foot-gun
   * from slipping in through a caller bug.
   */
  assertIcaoForRegion(region: string, icao: string): void {
    const cfg = this.getRegion(region);
    if (cfg.primary_station.icao !== icao) {
      throw new Error(
        `Station mismatch for region "${region}": expected ${cfg.primary_station.icao} ` +
          `(${cfg.primary_station.name}), got ${icao}. ` +
          `See station-map.json divergence_notes: ${cfg.divergence_notes}`,
      );
    }
  }
}
