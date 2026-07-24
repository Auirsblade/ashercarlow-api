// apps/swdnd/src/lib/panels.test.ts
import { describe, expect, test } from 'bun:test';
import {
  formatPanel, navigateFrom, panelPath, parsePanel, samePanel, splitPath, type Panel,
} from './panels';

const sheetA: Panel = { kind: 'sheet', id: 'a' };
const sheetB: Panel = { kind: 'sheet', id: 'b' };
const mapC: Panel = { kind: 'map', id: 'c' };
const dmC: Panel = { kind: 'dm', id: 'c' };

describe('parsePanel / formatPanel', () => {
  test('round-trips all three kinds', () => {
    for (const p of [sheetA, mapC, dmC]) {
      expect(parsePanel(formatPanel(p))).toEqual(p);
    }
  });
  test('accepts ids containing colons (uuids never do, but be safe)', () => {
    expect(parsePanel('sheet:a:b')).toEqual({ kind: 'sheet', id: 'a:b' });
  });
  test('rejects junk', () => {
    for (const bad of ['', 'sheet', 'sheet:', ':x', 'nope:x', 'sheet:a/b', 'map:']) {
      expect(parsePanel(bad)).toBeNull();
    }
  });
});

describe('paths', () => {
  test('panelPath maps kinds to their full-screen routes', () => {
    expect(panelPath(sheetA)).toBe('/sheet/a');
    expect(panelPath(mapC)).toBe('/map/c');
    expect(panelPath(dmC)).toBe('/dm/c');
  });
  test('splitPath composes descriptors', () => {
    expect(splitPath(sheetA, mapC)).toBe('/split/sheet:a/map:c');
  });
});

describe('samePanel', () => {
  test('kind and id must both match', () => {
    expect(samePanel(sheetA, { kind: 'sheet', id: 'a' })).toBe(true);
    expect(samePanel(sheetA, sheetB)).toBe(false);
    expect(samePanel(mapC, dmC)).toBe(false); // same id, different kind
  });
});

describe('navigateFrom — full screen (ctx null)', () => {
  test('plain click → target full screen', () => {
    expect(navigateFrom(null, mapC, sheetA, false)).toBe('/sheet/a');
  });
  test('alt-click with a current panel → split, current left / target right', () => {
    expect(navigateFrom(null, mapC, sheetA, true)).toBe('/split/map:c/sheet:a');
  });
  test('alt-click onto the current panel itself stays full screen', () => {
    expect(navigateFrom(null, mapC, mapC, true)).toBe('/map/c');
  });
  test('alt-click with no current panel (e.g. DmHome without a pair) → plain nav', () => {
    expect(navigateFrom(null, null, mapC, true)).toBe('/map/c');
  });
});

describe('navigateFrom — in a split', () => {
  const ctxLeft = { left: mapC, right: sheetA, side: 'left' as const };
  const ctxRight = { left: mapC, right: sheetA, side: 'right' as const };

  test('plain click replaces own side', () => {
    expect(navigateFrom(ctxLeft, mapC, dmC, false)).toBe('/split/dm:c/sheet:a');
    expect(navigateFrom(ctxRight, sheetA, sheetB, false)).toBe('/split/map:c/sheet:b');
  });
  test('alt-click replaces the other side', () => {
    expect(navigateFrom(ctxLeft, mapC, sheetB, true)).toBe('/split/map:c/sheet:b');
    expect(navigateFrom(ctxRight, sheetA, dmC, true)).toBe('/split/dm:c/sheet:a');
  });
  test('plain click onto what the other side shows collapses to it', () => {
    expect(navigateFrom(ctxLeft, mapC, sheetA, false)).toBe('/sheet/a');
  });
  test('alt-click onto what the own side shows collapses to it', () => {
    expect(navigateFrom(ctxRight, sheetA, sheetA, true)).toBe('/sheet/a');
  });
});
