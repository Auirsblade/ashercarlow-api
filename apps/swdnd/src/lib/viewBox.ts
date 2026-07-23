// apps/swdnd/src/lib/viewBox.ts — pure SVG viewBox pan/zoom math.
export interface ViewBox { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

export function panViewBox(vb: ViewBox, dx: number, dy: number): ViewBox {
  return { ...vb, x: vb.x + dx, y: vb.y + dy };
}

/** Scale by `factor` (<1 zooms in) keeping the map-space anchor fixed. */
export function zoomViewBox(
  vb: ViewBox, anchor: Pt, factor: number,
  clamp: { minW: number; maxW: number } = { minW: 40, maxW: 40000 },
): ViewBox {
  const w = Math.min(clamp.maxW, Math.max(clamp.minW, vb.w * factor));
  const eff = w / vb.w;
  const h = vb.h * eff;
  return {
    x: anchor.x - (anchor.x - vb.x) * eff,
    y: anchor.y - (anchor.y - vb.y) * eff,
    w, h,
  };
}

/** Screen px (relative to the svg's bounding rect) → map coordinates. */
export function clientToMap(
  vb: ViewBox, rect: { left: number; top: number; width: number; height: number },
  clientX: number, clientY: number,
): Pt {
  return {
    x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
    y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
  };
}

/** A viewBox framing a w×h image with proportional padding. */
export function fitViewBox(w: number, h: number, pad = 0.05): ViewBox {
  return { x: -w * pad, y: -h * pad, w: w * (1 + 2 * pad), h: h * (1 + 2 * pad) };
}
