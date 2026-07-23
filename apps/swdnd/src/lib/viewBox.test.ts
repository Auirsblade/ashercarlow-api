import { test, expect } from 'bun:test';
import { fitViewBox, panViewBox, zoomViewBox, clientToMap, clientDeltaToMap, viewScale, type ViewBox } from './viewBox';

const vb: ViewBox = { x: 0, y: 0, w: 1000, h: 500 };

test('panViewBox shifts by map-space delta', () => {
  expect(panViewBox(vb, 10, -20)).toEqual({ x: 10, y: -20, w: 1000, h: 500 });
});

test('zoomViewBox keeps the anchor point fixed and clamps scale', () => {
  const z = zoomViewBox(vb, { x: 500, y: 250 }, 0.5); // zoom in 2x at center
  expect(z.w).toBeCloseTo(500);
  expect(z.h).toBeCloseTo(250);
  expect(z.x).toBeCloseTo(250);
  expect(z.y).toBeCloseTo(125);
  // extreme factors clamp: never below 1/8 or above 8 of the base dimension passed
  const tiny = zoomViewBox(vb, { x: 0, y: 0 }, 0.0001, { minW: 100, maxW: 4000 });
  expect(tiny.w).toBe(100);
  const huge = zoomViewBox(vb, { x: 0, y: 0 }, 10000, { minW: 100, maxW: 4000 });
  expect(huge.w).toBe(4000);
});

test('clientToMap converts screen px to map coords when rect aspect matches viewBox aspect', () => {
  // svg rendered 500x250 showing a 1000x500 viewBox → no letterboxing, 2 map units per px
  const rect = { left: 0, top: 0, width: 500, height: 250 };
  const p = clientToMap(rect, vb, 250, 125);
  expect(p).toEqual({ x: 500, y: 250 });
});

test('clientToMap letterboxes (margins on y) when the rect is wider/flatter than the viewBox', () => {
  // rect 800x600 vs viewBox 1000x500: width-constrained, s=0.8, vertical margins of 100px
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  const s = 0.8;
  expect(viewScale(rect, vb)).toBeCloseTo(s);
  // top-left corner of the actual rendered image (below the top letterbox margin) → viewBox origin
  expect(clientToMap(rect, vb, 0, 100)).toEqual({ x: 0, y: 0 });
  // rect center must map to the viewBox center
  expect(clientToMap(rect, vb, 400, 300)).toEqual({ x: 500, y: 250 });
});

test('clientToMap pillarboxes (margins on x) when the rect is taller/narrower than the viewBox', () => {
  const tallVb: ViewBox = { x: 0, y: 0, w: 500, h: 1000 };
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  // height-constrained: s = 600/1000 = 0.6, horizontal margin = (800 - 500*0.6)/2 = 250
  const s = 0.6;
  expect(viewScale(rect, tallVb)).toBeCloseTo(s);
  expect(clientToMap(rect, tallVb, 250, 0)).toEqual({ x: 0, y: 0 });
  expect(clientToMap(rect, tallVb, 400, 300)).toEqual({ x: 250, y: 500 });
});

test('clientToMap accounts for a non-zero rect offset (left/top)', () => {
  const rect = { left: 40, top: 20, width: 800, height: 600 };
  expect(clientToMap(rect, vb, 40, 120)).toEqual({ x: 0, y: 0 });
});

test('clientDeltaToMap scales a screen-px delta by the same factor as clientToMap', () => {
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  expect(clientDeltaToMap(rect, vb, 80, 40)).toEqual({ dx: 100, dy: 50 });
});

test('fitViewBox frames content with padding, preserving aspect via width', () => {
  const f = fitViewBox(800, 600, 0.1);
  expect(f.x).toBeCloseTo(-80);
  expect(f.y).toBeCloseTo(-60);
  expect(f.w).toBeCloseTo(960);
  expect(f.h).toBeCloseTo(720);
});
