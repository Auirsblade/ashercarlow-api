import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MetarClient } from '../clients/metar.client';
import { NwsClient } from '../clients/nws.client';
import { FaaNasStatusClient } from '../clients/faa-nas-status.client';
import { ObserverRepository } from '../storage/observer.repository';
import { DiscrepancyService } from './discrepancy.service';
import { MarketScannerService } from './market-scanner.service';
import { ResolutionTrackerService } from './resolution-tracker.service';
import { StationMapperService } from './station-mapper.service';

/**
 * Periodic sampling loop for the Kalshi weather observer.
 *
 * Four independent cadences — each guarded against overlap via a boolean
 * running flag, and each wrapped in try/catch so one failing source can't
 * kill the scheduler:
 *
 *   Kalshi markets + prices   every  60s   (MarketScannerService.refresh)
 *   METAR observations        every   5min
 *   NWS CLI products          every  15min (authoritative resolution source)
 *   FAA NAS Status            every   3min (bonus severe-weather signal)
 *
 * All cadences are intentionally conservative for Phase 1. Kalshi Basic tier
 * rate limit is 20 reads/sec; at 60s refresh with ~40 requests per refresh,
 * we're sitting at well under 1 req/sec average.
 */
@Injectable()
export class SamplingService implements OnModuleInit {
  private readonly logger = new Logger(SamplingService.name);

  private kalshiRunning = false;
  private metarRunning = false;
  private nwsRunning = false;
  private faaRunning = false;
  private resolutionRunning = false;

  /**
   * Scheduler gate. Default ENABLED; set `KALSHI_OBSERVER_ENABLED=false`
   * in the environment to disable all @Interval ticks (the HTTP endpoints
   * still work, the DB just won't be written to by background jobs).
   *
   * This exists primarily so developers running `npm run start:dev` on
   * fresh clones don't accidentally hammer Kalshi/NOAA/NWS every 60s.
   */
  private readonly enabled =
    (process.env.KALSHI_OBSERVER_ENABLED ?? 'true').toLowerCase() !== 'false';

  constructor(
    private readonly scanner: MarketScannerService,
    private readonly stations: StationMapperService,
    private readonly metar: MetarClient,
    private readonly nws: NwsClient,
    private readonly faa: FaaNasStatusClient,
    private readonly repo: ObserverRepository,
    private readonly discrepancy: DiscrepancyService,
    private readonly resolutions: ResolutionTrackerService,
  ) {}

  onModuleInit(): void {
    this.logger.log('─'.repeat(70));
    this.logger.log('Kalshi weather observer — Phase 1 (READ-ONLY)');
    this.logger.log(
      `  Scheduler:       ${this.enabled ? 'ENABLED' : 'DISABLED (set KALSHI_OBSERVER_ENABLED=true)'}`,
    );
    this.logger.log(
      `  Trading:         NEVER (no order-construction code path exists in Phase 1)`,
    );
    this.logger.log(
      `  Kalshi key:      ${process.env.KALSHI_KEY_ID ? 'loaded (unused — Phase 1 reads are unauthenticated)' : 'not set'}`,
    );
    this.logger.log(
      `  Tracked regions: ${this.stations.listRegions().join(', ')}`,
    );
    this.logger.log('─'.repeat(70));
  }

  @Interval('kalshi-refresh', 60_000)
  async tickKalshi(): Promise<void> {
    if (!this.enabled) return;
    if (this.kalshiRunning) {
      this.logger.warn(
        'Skipping Kalshi refresh — previous run still in flight',
      );
      return;
    }
    this.kalshiRunning = true;
    try {
      await this.scanner.refresh();
      // Run discrepancy scan immediately after: we now have fresh prices,
      // and METAR/CLI are updated on their own cadence. Each scan writes
      // one discrepancy row per tracked market regardless of wouldTrade.
      this.discrepancy.scanAll();
    } catch (err) {
      this.logger.error(
        `Kalshi refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.kalshiRunning = false;
    }
  }

  @Interval('metar-sample', 300_000)
  async tickMetar(): Promise<void> {
    if (!this.enabled) return;
    if (this.metarRunning) return;
    this.metarRunning = true;
    try {
      await this.sampleMetar();
    } catch (err) {
      this.logger.error(
        `METAR sample failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.metarRunning = false;
    }
  }

  @Interval('nws-cli', 900_000)
  async tickNwsCli(): Promise<void> {
    if (!this.enabled) return;
    if (this.nwsRunning) return;
    this.nwsRunning = true;
    try {
      await this.sampleNwsCli();
    } catch (err) {
      this.logger.error(
        `NWS CLI sample failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.nwsRunning = false;
    }
  }

  @Interval('resolutions', 600_000)
  async tickResolutions(): Promise<void> {
    if (!this.enabled) return;
    if (this.resolutionRunning) return;
    this.resolutionRunning = true;
    try {
      await this.resolutions.checkResolutions();
    } catch (err) {
      this.logger.error(
        `Resolution check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.resolutionRunning = false;
    }
  }

  @Interval('faa-nas', 180_000)
  async tickFaa(): Promise<void> {
    if (!this.enabled) return;
    if (this.faaRunning) return;
    this.faaRunning = true;
    try {
      await this.sampleFaa();
    } catch (err) {
      this.logger.error(
        `FAA NAS sample failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.faaRunning = false;
    }
  }

  /**
   * Fetch latest METAR for every station referenced by the station map,
   * persist each unique observation. Idempotent via the UNIQUE(icao, observed_at)
   * constraint — duplicate obs are silently ignored.
   */
  async sampleMetar(): Promise<{
    stationsQueried: number;
    samplesInserted: number;
  }> {
    const icaos = this.stations.listAllIcaos();
    const obs = await this.metar.getMetar(icaos, 1);

    let inserted = 0;
    for (const o of obs) {
      if (!o.icaoId || !o.obsTime) continue;
      this.repo.insertMetarSample({
        icao: o.icaoId,
        observed_at: new Date(o.obsTime * 1000).toISOString(),
        temp_c: o.temp ?? null,
        dewpoint_c: o.dewp ?? null,
        wind_kt: typeof o.wspd === 'number' ? o.wspd : null,
        gust_kt: o.wgst ?? null,
        visibility: o.visib != null ? String(o.visib) : null,
        wx_phenomena: o.wxString ?? null,
        raw: o.rawOb ?? null,
      });
      inserted++;
    }

    this.logger.log(
      `METAR sample: ${icaos.length} stations queried, ${inserted} rows inserted`,
    );
    return { stationsQueried: icaos.length, samplesInserted: inserted };
  }

  /**
   * Fetch the latest NWS CLI product for every tracked location and parse.
   * This is the authoritative resolution source — what Kalshi uses to settle.
   */
  async sampleNwsCli(): Promise<{
    locationsQueried: number;
    samplesInserted: number;
  }> {
    const locations = this.stations.listAllCliLocations();

    let inserted = 0;
    for (const loc of locations) {
      try {
        const parsed = await this.nws.getLatestCli(loc.locationId);
        if (!parsed) continue;

        this.repo.insertNwsCliSample({
          cli_location_id: loc.locationId,
          product_id: parsed.productId,
          issuance_time: parsed.issuanceTime,
          observation_date: parsed.observationDate ?? null,
          max_temp_f: parsed.maxTempF ?? null,
          min_temp_f: parsed.minTempF ?? null,
          precip_in: parsed.precipIn ?? null,
          precip_is_trace: parsed.precipIsTrace ? 1 : 0,
          raw_text: parsed.rawText,
        });
        inserted++;
      } catch (err) {
        this.logger.warn(
          `CLI fetch failed for ${loc.locationId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `NWS CLI sample: ${locations.length} locations queried, ${inserted} rows inserted`,
    );
    return { locationsQueried: locations.length, samplesInserted: inserted };
  }

  /**
   * Fetch FAA NAS Status events for tracked airports. Stored to the DB as
   * a simple marker — discrepancy detection in Step 5 can join against this
   * to corroborate severe-weather signals.
   *
   * Phase 1: just log. Persistence of FAA events as first-class rows can land
   * with the discrepancy step since that's where they'll be consumed.
   */
  async sampleFaa(): Promise<{ airportsWithEvents: number }> {
    const iatas = this.stations.listAllIcaos().map((icao) => icao.slice(1)); // KNYC -> NYC
    const events = await this.faa.getEventsForAirports(iatas);

    let withEvents = 0;
    for (const [iata, ev] of events) {
      if (ev.groundDelay || ev.airportClosure || ev.deicing) {
        withEvents++;
        this.logger.log(
          `FAA event at ${iata}: groundDelay=${!!ev.groundDelay} closure=${!!ev.airportClosure} deicing=${!!ev.deicing}`,
        );
      }
    }
    return { airportsWithEvents: withEvents };
  }
}
