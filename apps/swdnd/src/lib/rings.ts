// apps/swdnd/src/lib/rings.ts — pure geometry for token HP arcs and status pies.
// Angles: 0 = 12 o'clock, increasing clockwise (SVG screen coords, y down).

export interface StatusSegment {
  name: string;
  path: string;                 // stroked arc path (or full-circle marker when full)
  full: boolean;                // single condition -> full ring
  color: string;
  label: { x: number; y: number }; // mid-band point: anchor for the initial fallback
  textArc: string | null;       // mid-band arc for <textPath>; direction-flipped on the bottom half
  textColor: string;            // contrast color for text inside the band
  fits: boolean;                // curved full name fits the arc
}

/** hp/maxHp -> 0..1, or null when not displayable (missing or zero max). */
export function hpFraction(hp: number | null, maxHp: number | null): number | null {
  if (hp == null || maxHp == null || maxHp <= 0) return null;
  return Math.min(1, Math.max(0, hp / maxHp));
}

export function hpColor(fraction: number): string {
  if (fraction > 0.5) return '#5dd39e';
  if (fraction > 0.25) return '#e8c268';
  return '#ff5470';
}

const polar = (r: number, angleDeg: number) => {
  const a = (angleDeg - 90) * (Math.PI / 180); // shift so 0° = 12 o'clock
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
};

/** Stroked arc from startDeg to endDeg (clockwise) at radius r, centered on origin. */
export function arcPath(r: number, startDeg: number, endDeg: number): string {
  const s = polar(r, startDeg);
  const e = polar(r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

/** HP arc: sweep = fraction of the full circle, starting at 12 o'clock. */
export function hpArcPath(r: number, fraction: number): string {
  if (fraction >= 1) {
    // A-to-self renders nothing; use the two-arc full-circle form.
    return `M 0 ${-r} a ${r} ${r} 0 1 1 0 ${2 * r} a ${r} ${r} 0 1 1 0 ${-2 * r}`;
  }
  return arcPath(r, 0, 360 * fraction);
}

const PALETTE = ['#c792ea', '#82aaff', '#f78c6c', '#ffcb6b', '#89ddff', '#f07178', '#a3f7bf', '#e6a1f2'];

/** Deterministic per-condition color: stable string hash into the palette. */
export function conditionColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Band stroke width and font size as fractions of the band-center radius. */
export const BAND_FRACTION = 0.34;
export const RING_FONT_FRACTION = 0.24;

const CHAR_WIDTH = 0.62;   // average monospace glyph width in em
const ARC_PADDING = 0.85;  // usable share of the arc for text

/** Relative-luminance (WCAG) contrast pick: dark text on light colors, light on dark. */
export function contrastText(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return '#f5fbff';
  const n = parseInt(m[1], 16);
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
  return lum >= 0.4 ? '#101418' : '#f5fbff';
}

/**
 * Arc path for <textPath>. flip=true draws end→start with sweep 0 (counter-
 * clockwise) so glyphs on bottom-half slices read upright instead of head-down.
 */
export function textArcPath(r: number, startDeg: number, endDeg: number, flip: boolean): string {
  const s = polar(r, startDeg);
  const e = polar(r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return flip
    ? `M ${e.x} ${e.y} A ${r} ${r} 0 ${large} 0 ${s.x} ${s.y}`
    : `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

const nameFits = (name: string, r: number, sweepDeg: number): boolean => {
  const fontSize = r * RING_FONT_FRACTION;
  const textWidth = name.length * CHAR_WIDTH * fontSize;
  const arcLength = r * (sweepDeg * Math.PI / 180);
  return textWidth <= arcLength * ARC_PADDING;
};

/** Midpoint in the bottom semicircle → the text arc must be flipped. */
const inBottomHalf = (midDeg: number): boolean => {
  const a = ((midDeg % 360) + 360) % 360;
  return a > 90 && a < 270;
};

/** N conditions -> N equal clockwise slices starting at 12 o'clock; text curves inside the band. */
export function statusSegments(conditions: string[], r: number): StatusSegment[] {
  const n = conditions.length;
  if (n === 0) return [];
  if (n === 1) {
    const name = conditions[0];
    const color = conditionColor(name);
    return [{
      name,
      path: hpArcPath(r, 1),
      full: true,
      color,
      label: { x: 0, y: -r },
      // full ring: a 340° arc whose midpoint (startOffset 50%) sits at 12 o'clock
      textArc: textArcPath(r, -170, 170, false),
      textColor: contrastText(color),
      fits: nameFits(name, r, 340),
    }];
  }
  const GAP = 4; // degrees of breathing room between slices
  const slice = 360 / n;
  return conditions.map((name, i) => {
    const start = i * slice + GAP / 2;
    const end = (i + 1) * slice - GAP / 2;
    const mid = i * slice + slice / 2;
    const labelPos = polar(r, mid);
    const color = conditionColor(name);
    return {
      name,
      path: arcPath(r, start, end),
      full: false,
      color,
      label: { x: labelPos.x, y: labelPos.y },
      textArc: textArcPath(r, start, end, inBottomHalf(mid)),
      textColor: contrastText(color),
      fits: nameFits(name, r, end - start),
    };
  });
}
