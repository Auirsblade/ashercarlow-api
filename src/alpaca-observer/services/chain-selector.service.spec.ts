import { AlpacaClient, AlpacaOptionSnapshot } from '../clients/alpaca.client';
import { ChainSelectorService } from './chain-selector.service';

describe('ChainSelectorService', () => {
  let alpaca: jest.Mocked<AlpacaClient>;
  let svc: ChainSelectorService;

  beforeEach(() => {
    alpaca = {} as unknown as jest.Mocked<AlpacaClient>;
    svc = new ChainSelectorService(alpaca);
  });

  /**
   * Build a fixture chain: puts and calls at integer strikes from 530-630
   * with synthetic deltas modeling SPY around 580. Linear coefficient 0.01
   * per dollar gives 0.20 delta exactly at $30 OTM (strikes 550 and 610).
   * Puts have negative delta, calls positive.
   */
  const fixtureChain = (
    expiration = '2026-05-15',
    spot = 580,
  ): AlpacaOptionSnapshot[] => {
    const out: AlpacaOptionSnapshot[] = [];
    for (let strike = 530; strike <= 630; strike += 1) {
      // Linear synthetic delta: -0.50 ATM, moves toward 0 as strike goes OTM.
      // 0.01 per $1 → -0.20 at strike 550 (30 OTM put), +0.20 at strike 610.
      const otmPutDistance = spot - strike; // positive when OTM put
      const otmCallDistance = strike - spot;
      const putDelta = Math.max(
        -0.99,
        Math.min(-0.01, -0.5 + otmPutDistance * 0.01),
      );
      const callDelta = Math.min(
        0.99,
        Math.max(0.01, 0.5 - otmCallDistance * 0.01),
      );

      out.push({
        symbol: `SPY260515P${String(strike * 1000).padStart(8, '0')}`,
        expirationDate: expiration,
        strikePrice: strike,
        type: 'put',
        greeks: { delta: putDelta },
        latestQuote: { bid: 1.0, ask: 1.2 },
      });
      out.push({
        symbol: `SPY260515C${String(strike * 1000).padStart(8, '0')}`,
        expirationDate: expiration,
        strikePrice: strike,
        type: 'call',
        greeks: { delta: callDelta },
        latestQuote: { bid: 1.0, ask: 1.2 },
      });
    }
    return out;
  };

  it('picks short put and short call closest to 0.20 delta', () => {
    const chain = fixtureChain();
    const result = svc.pickStrikesFromChain(chain, '2026-05-15');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { shortPut, shortCall, longPut, longCall } = result.target;
    // Short put delta should be close to -0.20
    expect(shortPut.greeks?.delta).toBeCloseTo(-0.2, 1);
    // Short call delta should be close to +0.20
    expect(shortCall.greeks?.delta).toBeCloseTo(0.2, 1);
    // Wings should be 5 points further OTM
    expect(longPut.strikePrice).toBeCloseTo(shortPut.strikePrice - 5, 0);
    expect(longCall.strikePrice).toBeCloseTo(shortCall.strikePrice + 5, 0);
    // Short put should be below short call (not inverted)
    expect(shortPut.strikePrice).toBeLessThan(shortCall.strikePrice);
  });

  it('estimates net credit using mid prices', () => {
    const chain = fixtureChain();
    const result = svc.pickStrikesFromChain(chain, '2026-05-15');
    if (!result.ok) throw new Error('expected ok');
    // All legs in fixture have bid=1.0 ask=1.2, mid=1.1
    // Credit = shortPut + shortCall - longPut - longCall = 1.1 + 1.1 - 1.1 - 1.1 = 0
    expect(result.target.estimatedCredit).toBeCloseTo(0);
  });

  it('estimates real credit when shorts are richer than longs', () => {
    const chain = fixtureChain();
    // Short put will be at strike 550, short call at 610 (0.20 delta in fixture).
    // Make those legs richer than the wings.
    for (const c of chain) {
      if (c.strikePrice === 550 && c.type === 'put') {
        c.latestQuote = { bid: 2.0, ask: 2.2 }; // mid 2.1
      }
      if (c.strikePrice === 610 && c.type === 'call') {
        c.latestQuote = { bid: 2.0, ask: 2.2 };
      }
    }
    const result = svc.pickStrikesFromChain(chain, '2026-05-15');
    if (!result.ok) throw new Error('expected ok');
    // Shorts mid=2.1, longs mid=1.1. Credit = 2.1+2.1 - 1.1-1.1 = 2.0
    expect(result.target.estimatedCredit).toBeGreaterThan(1.5);
  });

  it('fails with no_strikes_with_greeks when chain has no Greeks', () => {
    const chain = fixtureChain().map((c) => ({ ...c, greeks: undefined }));
    const result = svc.pickStrikesFromChain(chain, '2026-05-15');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe('no_strikes_with_greeks');
  });

  it('fails when long put wing is unavailable', () => {
    const chain = fixtureChain().filter(
      (c) => !(c.type === 'put' && c.strikePrice < 555),
    );
    const result = svc.pickStrikesFromChain(chain, '2026-05-15');
    if (result.ok) {
      // Possible: short put could end up high enough that wing is still in chain
      expect(result.target.shortPut.strikePrice).toBeGreaterThanOrEqual(560);
    } else {
      expect(result.failure.reason).toBe('long_put_wing_unavailable');
    }
  });

  it('detects inverted condor as a bug guard', () => {
    // Build a pathological chain where short put is at higher strike than short call
    const chain: AlpacaOptionSnapshot[] = [
      {
        symbol: 'P600',
        expirationDate: '2026-05-15',
        strikePrice: 600,
        type: 'put',
        greeks: { delta: -0.2 },
        latestQuote: { bid: 1.0, ask: 1.2 },
      },
      {
        symbol: 'P595',
        expirationDate: '2026-05-15',
        strikePrice: 595,
        type: 'put',
        greeks: { delta: -0.15 },
        latestQuote: { bid: 0.5, ask: 0.7 },
      },
      {
        symbol: 'C580',
        expirationDate: '2026-05-15',
        strikePrice: 580,
        type: 'call',
        greeks: { delta: 0.2 },
        latestQuote: { bid: 1.0, ask: 1.2 },
      },
      {
        symbol: 'C585',
        expirationDate: '2026-05-15',
        strikePrice: 585,
        type: 'call',
        greeks: { delta: 0.15 },
        latestQuote: { bid: 0.5, ask: 0.7 },
      },
    ];
    const result = svc.pickStrikesFromChain(chain, '2026-05-15');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe('inverted_condor');
  });
});
