// apps/swdnd/src/lib/sheetView.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type ReferenceData, type RefPower } from './rules/types';
import { remaining, powerCost, knownPowersByLevel } from './sheetView';

test('remaining never goes negative', () => {
  expect(remaining(22, 17)).toBe(5);
  expect(remaining(22, 30)).toBe(0);
});

test('powerCost is level+1, 0 for at-will', () => {
  expect(powerCost(0)).toBe(0);
  expect(powerCost(1)).toBe(2);
  expect(powerCost(3)).toBe(4);
});

test('knownPowersByLevel groups known ids by track then level, sorted', () => {
  const powers: Record<string, RefPower> = {
    push: { id: 'push', name: 'Force Push', level: 0, castType: 'force' },
    heal: { id: 'heal', name: 'Heal', level: 1, castType: 'force' },
    storm: { id: 'storm', name: 'Force Storm', level: 3, castType: 'force' },
    scan: { id: 'scan', name: 'Sensor Scan', level: 1, castType: 'tech' },
  };
  const ref = { powers } as unknown as ReferenceData;
  const b = emptyBuild('x');
  b.knownPowers = ['storm', 'push', 'heal', 'scan', 'missing'];
  const { force, tech } = knownPowersByLevel(b, ref);
  expect(force.map((g) => g.level)).toEqual([0, 1, 3]);
  expect(force[0].powers.map((p) => p.name)).toEqual(['Force Push']);
  expect(force[1].cost).toBe(2);
  expect(tech.map((g) => g.level)).toEqual([1]);
});
