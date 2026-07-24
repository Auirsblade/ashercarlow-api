// apps/swdnd/src/lib/rings.test.ts
import { describe, expect, it, test } from 'bun:test';
import {
  BAND_FRACTION,
  conditionColor,
  contrastText,
  hpArcPath,
  hpColor,
  hpFraction,
  RING_FONT_FRACTION,
  statusSegments,
  textArcPath,
} from './rings';

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
    expect(close(segs[0].label.y, -20)).toBe(true); // label sits on the band (mid-band radius, not outside)
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

describe('contrastText', () => {
  test('light palette colors get dark text, dark colors get light text', () => {
    expect(contrastText('#ffcb6b')).toBe('#101418'); // light amber
    expect(contrastText('#a3f7bf')).toBe('#101418'); // light green
    expect(contrastText('#1a2b3c')).toBe('#f5fbff'); // dark navy
    expect(contrastText('nonsense')).toBe('#f5fbff'); // unparsable → light default
  });
});

describe('textArcPath', () => {
  test('flip reverses direction (sweep flag 0, start/end swapped)', () => {
    const fwd = textArcPath(10, 0, 90, false);
    const rev = textArcPath(10, 0, 90, true);
    // flag runs are 'x-rotation large-arc sweep': forward sweeps 1, flipped sweeps 0
    expect(fwd).toContain(' 0 0 1 ');
    expect(rev).toContain(' 0 0 0 ');
    // the flipped arc starts (M x y) where the forward arc ends (last two tokens)
    expect(rev.split(' ').slice(1, 3)).toEqual(fwd.split(' ').slice(-2));
  });
});

describe('statusSegments labels', () => {
  test('single condition: full ring, curved name fits, arc not flipped', () => {
    const [s] = statusSegments(['stunned'], 40);
    expect(s.full).toBe(true);
    expect(s.fits).toBe(true);
    expect(s.textArc).not.toBeNull();
    expect(s.textColor).toBe(contrastText(s.color));
  });
  test('long name on a narrow slice does not fit; short one does', () => {
    const segs = statusSegments(["hunter's mark", 'web', 'prone', 'slow'], 40);
    const long = segs.find((s) => s.name === "hunter's mark")!;
    const short = segs.find((s) => s.name === 'web')!;
    expect(long.fits).toBe(false);
    expect(short.fits).toBe(true);
  });
  test('bottom-half slices get a reversed (sweep-0) text arc; top-half stay forward', () => {
    const segs = statusSegments(['aa', 'bb', 'cc', 'dd'], 40);
    // slices start at 12 o'clock clockwise: mid-angles 45°, 135°, 225°, 315°
    expect(segs[0].textArc).toContain(' 0 0 1 '); // 45° top-right → forward
    expect(segs[1].textArc).toContain(' 0 0 0 '); // 135° bottom-right → flipped
    expect(segs[2].textArc).toContain(' 0 0 0 '); // 225° bottom-left → flipped
    expect(segs[3].textArc).toContain(' 0 0 1 '); // 315° top-left → forward
  });
  test('label point moved onto the band (mid-band radius, not outside)', () => {
    const segs = statusSegments(['aa', 'bb'], 40);
    const d = Math.hypot(segs[0].label.x, segs[0].label.y);
    expect(d).toBeCloseTo(40, 0);
  });
  test('no conditions → no segments (unchanged)', () => {
    expect(statusSegments([], 40)).toEqual([]);
  });
});
