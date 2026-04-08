import * as fs from 'fs';
import * as path from 'path';
import { AlpacaClient } from './clients/alpaca.client';

/**
 * Phase 1 safety rails for the Alpaca options observer.
 *
 * The observer is paper-trading-only. This static test grep-walks the
 * module looking for any code path that points at the live trading API
 * or constructs a real-money order outside of guarded code paths.
 *
 * If any of these assertions fail, a future change has introduced live
 * trading capability into a module that is supposed to be paper-only.
 * Do NOT relax these assertions — isolate live trading code into a
 * dedicated module that does not share files with the observer.
 */
describe('alpaca-observer safety rails', () => {
  const moduleRoot = path.resolve(__dirname);

  function walkTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walkTsFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  const sourceFiles = walkTsFiles(moduleRoot).filter(
    (f) => !f.endsWith('.spec.ts'),
  );

  it('contains no references to the live Alpaca trading host as a code value', () => {
    // We allow `api.alpaca.markets` to be mentioned IF it appears in:
    //  - a comment or docstring
    //  - a refusal/error message
    //  - the FORBIDDEN_LIVE_HOSTS guard list itself
    const violations: Array<{ file: string; line: string }> = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.includes('api.alpaca.markets')) continue;
        const trimmed = line.trim();
        const isComment =
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*');
        const isRefusal = /refused|forbidden|never|paper-only|FORBIDDEN/i.test(
          trimmed,
        );
        const isPaperUrl = /paper-api\.alpaca\.markets/.test(trimmed);
        if (!isComment && !isRefusal && !isPaperUrl) {
          violations.push({
            file: path.relative(moduleRoot, file),
            line: trimmed.slice(0, 140),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('AlpacaClient refuses to construct against the live host', () => {
    const original = process.env.ALPACA_BASE_URL;
    try {
      process.env.ALPACA_BASE_URL = 'https://api.alpaca.markets';
      expect(() => new AlpacaClient()).toThrow(/refused to construct/);
    } finally {
      if (original === undefined) {
        delete process.env.ALPACA_BASE_URL;
      } else {
        process.env.ALPACA_BASE_URL = original;
      }
    }
  });
});
