// apps/swdnd/src/lib/rings.ts — pure geometry for token HP arcs and status pies.
// Angles: 0 = 12 o'clock, increasing clockwise (SVG screen coords, y down).

export interface StatusSegment {
  name: string;
  path: string;                 // stroked arc path (or full-circle marker when full)
  full: boolean;                // single condition -> full ring
  color: string;
  label: { x: number; y: number };
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

const LABEL_OFFSET = 6;

/** N conditions -> N equal clockwise slices starting at 12 o'clock, labels at slice mid-angles. */
export function statusSegments(conditions: string[], r: number): StatusSegment[] {
  const n = conditions.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{
      name: conditions[0],
      path: hpArcPath(r, 1),
      full: true,
      color: conditionColor(conditions[0]),
      label: { x: 0, y: -r - LABEL_OFFSET },
    }];
  }
  const GAP = 4; // degrees of breathing room between slices
  const slice = 360 / n;
  return conditions.map((name, i) => {
    const start = i * slice;
    const mid = start + slice / 2;
    const labelPos = polar(r + LABEL_OFFSET, mid);
    return {
      name,
      path: arcPath(r, start + GAP / 2, start + slice - GAP / 2),
      full: false,
      color: conditionColor(name),
      label: { x: labelPos.x, y: labelPos.y },
    };
  });
}
