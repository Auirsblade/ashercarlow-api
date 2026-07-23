import { test, expect } from 'bun:test';
import { fitViewBox, panViewBox, zoomViewBox, clientToMap, type ViewBox } from './viewBox';

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

test('clientToMap converts screen px to map coords through the viewBox', () => {
  // svg rendered 500px wide showing 1000 map units → 2 map units per px
  const p = clientToMap(vb, { left: 0, top: 0, width: 500, height: 250 }, 250, 125);
  expect(p).toEqual({ x: 500, y: 250 });
});

test('fitViewBox frames content with padding, preserving aspect via width', () => {
  const f = fitViewBox(800, 600, 0.1);
  expect(f.x).toBeCloseTo(-80);
  expect(f.y).toBeCloseTo(-60);
  expect(f.w).toBeCloseTo(960);
  expect(f.h).toBeCloseTo(720);
});
