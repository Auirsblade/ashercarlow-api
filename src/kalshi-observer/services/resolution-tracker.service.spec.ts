import { KalshiClient, KalshiMarket } from '../clients/kalshi.client';
import {
  ObserverRepository,
  TrackedMarketRow,
} from '../storage/observer.repository';
import { ResolutionTrackerService } from './resolution-tracker.service';
import { SimulatorService } from './simulator.service';

describe('ResolutionTrackerService', () => {
  let repo: ObserverRepository;
  let kalshi: jest.Mocked<KalshiClient>;
  let simulator: SimulatorService;
  let svc: ResolutionTrackerService;

  const market: TrackedMarketRow = {
    ticker: 'KXHIGHNY-26APR08-T55',
    event_ticker: 'KXHIGHNY-26APR08',
    series_ticker: 'KXHIGHNY',
    category: 'high_temp',
    region: 'nyc',
    title: null,
    rules_primary: null,
    threshold_json: JSON.stringify({ op: 'greater', value: 55 }),
    expected_expiration_time: null,
    latest_expiration_time: null,
    resolution_source_json: '{}',
    mapped_metar_icao: 'KNYC',
    mapping_confidence: 'high',
    mapping_notes: null,
    status: 'active',
    first_seen_at: '2026-04-08T00:00:00Z',
    last_seen_at: '2026-04-08T00:00:00Z',
  };

  beforeEach(() => {
    repo = new ObserverRepository();
    repo.useInMemoryForTests();
    simulator = new SimulatorService(repo);
    kalshi = {
      getMarket: jest.fn(),
    } as unknown as jest.Mocked<KalshiClient>;
    svc = new ResolutionTrackerService(repo, kalshi, simulator);

    repo.upsertMarket(market);
  });

  afterEach(() => {
    repo.close();
  });

  const openTestPosition = (side: 'yes' | 'no' = 'yes') =>
    repo.openPosition({
      market_ticker: market.ticker,
      opened_at: '2026-04-08T15:00:00Z',
      side,
      size_usd: 50,
      entry_price: 0.4,
    });

  const kalshiMarket = (status: string, result: string): KalshiMarket => ({
    ticker: market.ticker,
    status,
    result,
  });

  it('closes an open position when the market resolves YES', async () => {
    const id = openTestPosition('yes');
    kalshi.getMarket.mockResolvedValue(kalshiMarket('settled', 'yes'));

    const summary = await svc.checkResolutions();

    expect(summary.closed).toBe(1);
    expect(repo.findOpenPositionForMarket(market.ticker)).toBeUndefined();

    // Verify the close + PnL
    const db = (
      repo as unknown as {
        db: { prepare: (s: string) => { get: (id: number) => unknown } };
      }
    ).db;
    const pos = db
      .prepare('SELECT * FROM simulated_position WHERE id = ?')
      .get(id) as { resolution_outcome: string; realized_pnl_usd: number };
    expect(pos.resolution_outcome).toBe('yes');
    expect(pos.realized_pnl_usd).toBeCloseTo(75); // 50/0.4 * 0.6
  });

  it('closes an open position when the market resolves NO (loss)', async () => {
    openTestPosition('yes');
    kalshi.getMarket.mockResolvedValue(kalshiMarket('finalized', 'no'));

    const summary = await svc.checkResolutions();
    expect(summary.closed).toBe(1);
  });

  it('does not close positions on still-active markets', async () => {
    openTestPosition('yes');
    kalshi.getMarket.mockResolvedValue(kalshiMarket('active', ''));

    const summary = await svc.checkResolutions();
    expect(summary.closed).toBe(0);
    expect(repo.findOpenPositionForMarket(market.ticker)).toBeDefined();
  });

  it('handles void resolutions with zero PnL', async () => {
    openTestPosition('yes');
    kalshi.getMarket.mockResolvedValue(kalshiMarket('settled', 'void'));

    const summary = await svc.checkResolutions();
    expect(summary.closed).toBe(1);
    expect(simulator.computeFreeBankroll()).toBe(1000);
  });

  it('skips unknown result values and logs a warning', async () => {
    openTestPosition('yes');
    kalshi.getMarket.mockResolvedValue(kalshiMarket('settled', 'mystery'));

    const summary = await svc.checkResolutions();
    expect(summary.closed).toBe(0);
    expect(repo.findOpenPositionForMarket(market.ticker)).toBeDefined();
  });

  it('counts errors from Kalshi API failures without crashing', async () => {
    openTestPosition('yes');
    kalshi.getMarket.mockRejectedValue(new Error('network blew up'));

    const summary = await svc.checkResolutions();
    expect(summary.errors).toBe(1);
    expect(summary.closed).toBe(0);
  });

  it('returns early when there are no open positions', async () => {
    const summary = await svc.checkResolutions();
    expect(summary.openPositionsChecked).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(kalshi.getMarket).not.toHaveBeenCalled();
  });
});
