// apps/swdnd/src/lib/rings.test.ts
import { describe, expect, it } from 'bun:test';
import { conditionColor, hpArcPath, hpColor, hpFraction, statusSegments } from './rings';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('hp arc', () => {
  it('hpFraction clamps to 0..1 and handles null/zero max', () => {
    expect(hpFraction(5, 10)).toBe(0.5);
    expect(hpFraction(15, 10)).toBe(1);
    expect(hpFraction(-3, 10)).toBe(0);
    expect(hpFraction(5, 0)).toBeNull();
    expect(hpFraction(null, 10)).toBeNull();
    expect(hpFraction(5, null)).toBeNull();
  });

  it('hpColor bands green/amber/red', () => {
    expect(hpColor(1)).toBe('#5dd39e');
    expect(hpColor(0.51)).toBe('#5dd39e');
    expect(hpColor(0.5)).toBe('#e8c268');
    expect(hpColor(0.26)).toBe('#e8c268');
    expect(hpColor(0.25)).toBe('#ff5470');
    expect(hpColor(0)).toBe('#ff5470');
  });

  it('full fraction is a complete circle path, partial is an arc from 12 o clock', () => {
    expect(hpArcPath(10, 1)).toContain('a 10 10'); // two-arc full circle form
    const half = hpArcPath(10, 0.5); // 12 o'clock -> 6 o'clock clockwise
    // end point of a 50% sweep is (0, +r) relative to center.
    // NB: near-zero coords serialize in scientific notation (6.12e-16), so the
    // number regex must include the exponent or it splits at the 'e'.
    const nums = half.match(/-?\d+(\.\d+)?(e[+-]?\d+)?/g)!.map(Number);
    const endY = nums[nums.length - 1];
    const endX = nums[nums.length - 2];
    expect(close(endX, 0)).toBe(true);
    expect(close(endY, 10)).toBe(true);
  });
});

describe('status pie', () => {
  it('one condition = one full-ring segment with a top label', () => {
    const segs = statusSegments(['hunters-mark'], 20);
    expect(segs.length).toBe(1);
    expect(segs[0].name).toBe('hunters-mark');
    expect(segs[0].full).toBe(true);
    expect(close(segs[0].label.y, -20 - 6)).toBe(true); // label sits above the ring
  });

  it('N conditions split into N equal segments with distinct mid-angle labels', () => {
    const segs = statusSegments(['a', 'b', 'c'], 20);
    expect(segs.length).toBe(3);
    // mid-angles at 60°, 180°, 300° (each slice is 120° starting at 12 o'clock)
    const angles = segs.map((s) => Math.atan2(s.label.x, -s.label.y) * 180 / Math.PI);
    expect(close((angles[0] + 360) % 360, 60)).toBe(true);
    expect(close((angles[1] + 360) % 360, 180)).toBe(true);
    expect(close((angles[2] + 360) % 360, 300)).toBe(true);
  });

  it('conditionColor is deterministic and palette-bound', () => {
    expect(conditionColor('hunters-mark')).toBe(conditionColor('hunters-mark'));
    expect(conditionColor('x')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('no conditions -> no segments', () => {
    expect(statusSegments([], 20)).toEqual([]);
  });
});
