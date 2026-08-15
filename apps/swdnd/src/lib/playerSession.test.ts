// apps/swdnd/src/lib/playerSession.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { clearStoredToken, getStoredToken, setStoredToken } from './playerSession';

// DEVIATION from the brief: bun:test on this repo's Bun (1.3.9) does NOT provide
// a global `localStorage` (confirmed: `bun -e "localStorage"` → ReferenceError).
// Polyfill a minimal Map-backed Storage before the suite runs so the tests below
// exercise real getItem/setItem/removeItem semantics, matching the codebase's
// existing convention of stubbing a global directly in the test file (see the
// globalThis.fetch stub in starships.test.ts) rather than adding a repo-wide
// bunfig.toml preload that would touch all 618+ other tests.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

// Each test leaves the key clean so ordering never matters.
afterEach(() => clearStoredToken());

describe('playerSession', () => {
  it('round-trips a token', () => {
    setStoredToken('488c2546-fabf-4a92-bc95-c40bb9035b66');
    expect(getStoredToken()).toBe('488c2546-fabf-4a92-bc95-c40bb9035b66');
  });

  it('returns null when nothing is stored', () => {
    expect(getStoredToken()).toBeNull();
  });

  it('clear removes the stored token', () => {
    setStoredToken('abc');
    clearStoredToken();
    expect(getStoredToken()).toBeNull();
  });

  it('set is a no-op on empty and whitespace', () => {
    setStoredToken('');
    expect(getStoredToken()).toBeNull();
    setStoredToken('   ');
    expect(getStoredToken()).toBeNull();
  });

  it('trims on write and read', () => {
    setStoredToken('  abc  ');
    expect(getStoredToken()).toBe('abc');
  });

  it('treats stored whitespace junk as absent', () => {
    globalThis.localStorage.setItem('swdnd.playerToken', '   ');
    expect(getStoredToken()).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    const original = globalThis.localStorage;
    // Simulate private-mode / disabled storage: every access throws.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('denied'); },
    });
    try {
      expect(getStoredToken()).toBeNull();
      expect(() => setStoredToken('abc')).not.toThrow();
      expect(() => clearStoredToken()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: original });
    }
  });
});
