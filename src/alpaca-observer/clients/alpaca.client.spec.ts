import { AlpacaClient, buildOccSymbol, parseOccSymbol } from './alpaca.client';

describe('AlpacaClient', () => {
  describe('safety: live URL refusal', () => {
    const originalBaseUrl = process.env.ALPACA_BASE_URL;
    afterEach(() => {
      if (originalBaseUrl === undefined) {
        delete process.env.ALPACA_BASE_URL;
      } else {
        process.env.ALPACA_BASE_URL = originalBaseUrl;
      }
    });

    it('constructs against paper URL by default', () => {
      delete process.env.ALPACA_BASE_URL;
      expect(() => new AlpacaClient()).not.toThrow();
    });

    it('refuses to construct against the live URL', () => {
      process.env.ALPACA_BASE_URL = 'https://api.alpaca.markets';
      expect(() => new AlpacaClient()).toThrow(/refused to construct/);
    });

    it('refuses any URL containing the live host', () => {
      process.env.ALPACA_BASE_URL = 'https://api.alpaca.markets/v2';
      expect(() => new AlpacaClient()).toThrow(/Phase 1 is paper-only/);
    });

    it('accepts an explicit paper URL', () => {
      process.env.ALPACA_BASE_URL = 'https://paper-api.alpaca.markets';
      expect(() => new AlpacaClient()).not.toThrow();
    });
  });

  describe('parseOccSymbol', () => {
    it('parses a SPY put correctly', () => {
      const parsed = parseOccSymbol('SPY260515P00580000');
      expect(parsed).toEqual({
        underlying: 'SPY',
        expirationDate: '2026-05-15',
        type: 'put',
        strikePrice: 580,
      });
    });

    it('parses a SPY call correctly', () => {
      const parsed = parseOccSymbol('SPY260515C00595500');
      expect(parsed).toEqual({
        underlying: 'SPY',
        expirationDate: '2026-05-15',
        type: 'call',
        strikePrice: 595.5,
      });
    });

    it('returns null for invalid symbols', () => {
      expect(parseOccSymbol('not-a-symbol')).toBeNull();
      expect(parseOccSymbol('SPY')).toBeNull();
    });
  });

  describe('buildOccSymbol', () => {
    it('builds a SPY put correctly', () => {
      expect(buildOccSymbol('SPY', '2026-05-15', 'put', 580)).toBe(
        'SPY260515P00580000',
      );
    });

    it('builds a SPY call with fractional strike', () => {
      expect(buildOccSymbol('SPY', '2026-05-15', 'call', 595.5)).toBe(
        'SPY260515C00595500',
      );
    });

    it('round-trips with parseOccSymbol', () => {
      const symbol = buildOccSymbol('SPY', '2026-05-15', 'put', 580);
      const parsed = parseOccSymbol(symbol);
      expect(parsed?.strikePrice).toBe(580);
      expect(parsed?.expirationDate).toBe('2026-05-15');
      expect(parsed?.type).toBe('put');
    });
  });
});
