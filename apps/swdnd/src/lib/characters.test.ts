// apps/swdnd/src/lib/characters.test.ts
import { test, expect, afterEach } from 'bun:test';
import { mapClassRow, mapArmorRow, mapPowerRow } from './characters';

afterEach(() => { /* no global state */ });

test('mapClassRow pulls hitDie, saves, powercasting, superiority from raw_json', () => {
  const row = {
    id: 'consular', name: 'Consular',
    raw_json: JSON.stringify({
      system: {
        hitDice: 'd6', saves: ['wis', 'cha'],
        skills: { number: 2, choices: ['ins', 'lor', 'per'] },
        powercasting: { force: 'full', tech: 'none', forceOverride: '', techOverride: '' },
        superiority: { progression: '0' },
      },
    }),
  };
  const c = mapClassRow(row);
  expect(c).toMatchObject({
    id: 'consular', name: 'Consular', hitDie: 6, saves: ['wis', 'cha'],
    skillNumber: 2, skillChoices: ['ins', 'lor', 'per'],
    powercasting: { force: 'full', tech: 'none' }, superiorityProgression: 0,
  });
});

test('mapArmorRow classifies kind and dex cap', () => {
  const row = { id: 'b', name: 'Beskar', raw_json: JSON.stringify({ system: { armor: { value: 14, type: 'medium', dex: 2 } } }) };
  expect(mapArmorRow(row)).toEqual({ id: 'b', name: 'Beskar', baseAc: 14, dexCap: 2, kind: 'medium' });
  const light = { id: 'l', name: 'Combat suit', raw_json: JSON.stringify({ system: { armor: { value: 11, type: 'light', dex: null } } }) };
  expect(mapArmorRow(light).dexCap).toBeNull();
});

test('mapPowerRow reads level and infers cast type from power_type column', () => {
  const row = { id: 'p', name: 'Force Push', power_type: 'force', raw_json: JSON.stringify({ system: { level: 1 } }) };
  expect(mapPowerRow(row)).toEqual({ id: 'p', name: 'Force Push', level: 1, castType: 'force' });
});
