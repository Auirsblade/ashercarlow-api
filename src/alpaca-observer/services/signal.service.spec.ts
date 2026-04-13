import { AlpacaClient, StockBar } from '../clients/alpaca.client';
import { MarketDataClient } from '../clients/market-data.client';
import { AlpacaObserverRepository } from '../storage/alpaca-observer.repository';
import { SignalService } from './signal.service';

describe('SignalService', () => {
  let alpaca: jest.Mocked<AlpacaClient>;
  let marketData: jest.Mocked<MarketDataClient>;
  let repo: AlpacaObserverRepository;
  let svc: SignalService;

  beforeEach(() => {
    repo = new AlpacaObserverRepository();
    repo.useInMemoryForTests();

    alpaca = {
      getStockBars: jest.fn(),
    } as unknown as jest.Mocked<AlpacaClient>;
    marketData = {
      getLatestVix: jest.fn(),
    } as unknown as jest.Mocked<MarketDataClient>;

    svc = new SignalService(alpaca, marketData, repo);
  });

  afterEach(() => {
    repo.close();
  });

  /** Build a deterministic SPY bar series with constant daily return. */
  const flatBars = (n: number, basePrice = 580): StockBar[] => {
    const out: StockBar[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        symbol: 'SPY',
        timestamp: `2026-03-${String(i + 1).padStart(2, '0')}T20:00:00Z`,
        open: basePrice,
        high: basePrice,
        low: basePrice,
        close: basePrice,
        volume: 1000000,
      });
    }
    return out;
  };

  /** Bars with daily 1% moves alternating up/down → high RV. */
  const volatileBars = (n: number, basePrice = 580): StockBar[] => {
    const out: StockBar[] = [];
    let p = basePrice;
    for (let i = 0; i < n; i++) {
      p = p * (i % 2 === 0 ? 1.01 : 0.99);
      out.push({
        symbol: 'SPY',
        timestamp: `2026-03-${String(i + 1).padStart(2, '0')}T20:00:00Z`,
        open: p,
        high: p,
        low: p,
        close: p,
        volume: 1000000,
      });
    }
    return out;
  };

  it('classifies favorable regime when VIX is in range', async () => {
    marketData.getLatestVix.mockResolvedValue({
      date: '2026-04-07',
      close: 18,
    });
    alpaca.getStockBars.mockResolvedValue(flatBars(35));

    const sig = await svc.evaluate();
    expect(sig.regime).toBe('favorable');
    expect(sig.entryEligible).toBe(true);
    expect(sig.vix).toBe(18);
  });

  it('classifies vol_too_low when VIX < 12', async () => {
    marketData.getLatestVix.mockResolvedValue({
      date: '2026-04-07',
      close: 10,
    });
    alpaca.getStockBars.mockResolvedValue(flatBars(35));

    const sig = await svc.evaluate();
    expect(sig.regime).toBe('vol_too_low');
    expect(sig.entryEligible).toBe(false);
    expect(sig.reason).toMatch(/below_12/);
  });

  it('classifies vol_too_high when VIX > 35', async () => {
    marketData.getLatestVix.mockResolvedValue({
      date: '2026-04-07',
      close: 50,
    });
    alpaca.getStockBars.mockResolvedValue(flatBars(35));

    const sig = await svc.evaluate();
    expect(sig.regime).toBe('vol_too_high');
    expect(sig.entryEligible).toBe(false);
  });

  it('returns unknown regime on data errors', async () => {
    marketData.getLatestVix.mockRejectedValue(new Error('stooq down'));
    alpaca.getStockBars.mockResolvedValue(flatBars(35));

    const sig = await svc.evaluate();
    expect(sig.regime).toBe('unknown');
    expect(sig.entryEligible).toBe(false);
  });

  it('persists a signal_sample row', async () => {
    marketData.getLatestVix.mockResolvedValue({
      date: '2026-04-07',
      close: 18,
    });
    alpaca.getStockBars.mockResolvedValue(flatBars(35));

    await svc.evaluate();

    const db = (
      repo as unknown as {
        db: { prepare: (s: string) => { all: () => unknown[] } };
      }
    ).db;
    const rows = db.prepare('SELECT * FROM signal_sample').all() as Array<{
      regime: string;
      entry_eligible: number;
      vix: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].regime).toBe('favorable');
    expect(rows[0].entry_eligible).toBe(1);
    expect(rows[0].vix).toBe(18);
  });

  describe('computeRealizedVol', () => {
    it('returns 0 for flat price series', () => {
      const rv = svc.computeRealizedVol(flatBars(35), 30);
      expect(rv).toBe(0);
    });

    it('returns null when not enough bars', () => {
      const rv = svc.computeRealizedVol(flatBars(10), 30);
      expect(rv).toBeNull();
    });

    it('returns positive value for volatile series', () => {
      const rv = svc.computeRealizedVol(volatileBars(35), 30);
      expect(rv).not.toBeNull();
      expect(rv!).toBeGreaterThan(0);
      // 1% daily moves annualize to ~16% vol
      expect(rv!).toBeGreaterThan(10);
      expect(rv!).toBeLessThan(25);
    });
  });
});
