// apps/swdnd/src/lib/templates.test.ts
import { describe, expect, it } from 'bun:test';
import { dirFromPoint, templateHexes } from './templates';
import type { TemplateDto } from './scenes';
import type { GridConfig } from './hex';

const tpl = (over: Partial<TemplateDto>): TemplateDto => ({
  id: 'x', scene_id: 's', kind: 'blast', q: 0, r: 0, dir: 0, size: 1,
  q2: null, r2: null, color: '#fff', created_at: '', ...over,
});
const pointy: GridConfig = { orientation: 'pointy', hexSize: 32, originX: 0, originY: 0, unitsPerHex: 5, unitLabel: 'ft' };
const flat: GridConfig = { ...pointy, orientation: 'flat' };

describe('templateHexes', () => {
  it('blast radius 1 = 7 hexes incl. center', () => {
    const h = templateHexes(tpl({ kind: 'blast', size: 1 }));
    expect(h.length).toBe(7);
    expect(h).toContainEqual({ q: 0, r: 0 });
  });

  it('cone length 2 = 5 hexes, origin excluded (L(L+3)/2)', () => {
    const h = templateHexes(tpl({ kind: 'cone', dir: 0, size: 2 }));
    expect(h.length).toBe(5);
    expect(h).not.toContainEqual({ q: 0, r: 0 });
  });

  it('line = hexLine to the endpoint', () => {
    const h = templateHexes(tpl({ kind: 'line', q2: 3, r2: 0 }));
    expect(h.length).toBe(4); // 0,0 .. 3,0 inclusive
    expect(h[0]).toEqual({ q: 0, r: 0 });
    expect(h[3]).toEqual({ q: 3, r: 0 });
  });

  it('line without endpoint yields []', () => {
    expect(templateHexes(tpl({ kind: 'line', q2: null, r2: null }))).toEqual([]);
  });
});

describe('dirFromPoint', () => {
  it('pointy: a point due right of the origin snaps to dir 0 (q+1)', () => {
    // pointy dir 0 = (1,0): pixel offset (sqrt(3)*s, 0) — straight right.
    expect(dirFromPoint({ q: 0, r: 0 }, 100, 0, pointy)).toBe(0);
  });
  it('pointy: a point due left snaps to dir 3 (q-1)', () => {
    expect(dirFromPoint({ q: 0, r: 0 }, -100, 0, pointy)).toBe(3);
  });
  it('flat: a point straight down snaps to dir 5 (0,+1)', () => {
    // flat dir 5 = (0,1): pixel offset (0, sqrt(3)*s) — straight down (y grows downward).
    expect(dirFromPoint({ q: 0, r: 0 }, 0, 100, flat)).toBe(5);
  });
  it('a point exactly on the origin falls back to dir 0', () => {
    expect(dirFromPoint({ q: 0, r: 0 }, 0, 0, pointy)).toBe(0);
  });
});
