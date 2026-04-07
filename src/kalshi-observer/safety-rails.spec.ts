import * as fs from 'fs';
import * as path from 'path';
import { KalshiClient } from './clients/kalshi.client';

/**
 * Phase 1 safety rails test.
 *
 * The observer is a read-only tool. This test statically verifies that
 * the kalshi-observer module contains no trade-construction code paths.
 * If any of these assertions fail, a future change has introduced a
 * Phase 2 trading capability into what is supposed to be a Phase 1
 * observer. Do NOT relax these assertions — instead, isolate trading
 * code into a dedicated module that does not share files with this one.
 */
describe('kalshi-observer safety rails', () => {
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

  it('contains no references to Kalshi order-construction endpoints', () => {
    const forbiddenPatterns = [
      /\/portfolio\/orders/,
      /createOrder/i,
      /placeOrder/i,
      /submit_order/i,
      /cancelOrder/i,
      /amendOrder/i,
    ];

    const violations: Array<{ file: string; pattern: string; line: string }> =
      [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        const match = content.match(pattern);
        if (match) {
          // Allow mentions inside comments or error messages that explicitly
          // refuse. We scan line by line to be honest about it.
          const lines = content.split('\n');
          for (const line of lines) {
            if (pattern.test(line)) {
              const trimmed = line.trim();
              const isComment =
                trimmed.startsWith('//') ||
                trimmed.startsWith('*') ||
                trimmed.startsWith('/*');
              const isRefusal =
                /not available|is not|do not|Phase 1|never/i.test(trimmed);
              if (!isComment && !isRefusal) {
                violations.push({
                  file: path.relative(moduleRoot, file),
                  pattern: pattern.source,
                  line: trimmed.slice(0, 120),
                });
              }
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('contains no POST/PUT/DELETE HTTP method calls from the observer', () => {
    const violations: Array<{ file: string; line: string }> = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        // Look for fetch(... method: 'POST'|'PUT'|'DELETE') patterns.
        if (/method:\s*['"](POST|PUT|DELETE|PATCH)['"]/i.test(line)) {
          violations.push({
            file: path.relative(moduleRoot, file),
            line: line.trim().slice(0, 120),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('KalshiClient.signRequest throws (trading guard)', () => {
    const client = new KalshiClient();
    expect(() => client.signRequest('POST', '/portfolio/orders', 1)).toThrow(
      /Phase 1/,
    );
  });
});
