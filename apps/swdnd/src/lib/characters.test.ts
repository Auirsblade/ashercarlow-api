// apps/swdnd/src/lib/characters.test.ts
import { test, expect, afterEach } from 'bun:test';
import {
  mapClassRow, mapArchetypeRow, mapArmorRow, mapPowerRow,
  mapSpeciesRow, mapBackgroundRow, mapFeatRow, mapManeuverRow, mapGearRow,
} from './characters';

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
  expect(mapArmorRow(row)).toMatchObject({ id: 'b', name: 'Beskar', baseAc: 14, dexCap: 2, kind: 'medium' });
  const light = { id: 'l', name: 'Combat suit', raw_json: JSON.stringify({ system: { armor: { value: 11, type: 'light', dex: null } } }) };
  expect(mapArmorRow(light).dexCap).toBeNull();
});

test('mapPowerRow reads level and infers cast type from power_type column', () => {
  const row = { id: 'p', name: 'Force Push', power_type: 'force', raw_json: JSON.stringify({ system: { level: 1 } }) };
  expect(mapPowerRow(row)).toMatchObject({ id: 'p', name: 'Force Push', level: 1, castType: 'force' });
});

test('mapSpeciesRow extracts ability increases and description', () => {
  const row = {
    id: 'zabrak', name: 'Zabrak',
    raw_json: JSON.stringify({
      system: {
        movement: { walk: 30 },
        description: { value: '<p>Hardy &amp; determined.</p>' },
        advancement: [
          { type: 'ItemGrant', configuration: {} },
          { type: 'AbilityScoreImprovement', configuration: { fixed: { con: 2 }, points: 1 } },
        ],
      },
    }),
  };
  const s = mapSpeciesRow(row);
  expect(s.abilityIncreases).toEqual({ fixed: { con: 2 }, points: 1 });
  expect(s.description).toContain('Hardy & determined.');
  const none = mapSpeciesRow({ id: 'x', name: 'X', raw_json: JSON.stringify({ system: { movement: { walk: 25 } } }) });
  expect(none.abilityIncreases).toBeNull();
});

test('mapBackgroundRow pulls prose fields (string or {value} shapes)', () => {
  const row = {
    id: 'jedi', name: 'Jedi',
    raw_json: JSON.stringify({
      system: {
        description: { value: '<p>Order member.</p>' },
        featureName: { value: 'Shelter of the Faithful' },
        skillProficiencies: { value: 'Choose two from Insight, Lore, …' },
        toolProficiencies: { value: 'None' },
        equipment: { value: 'A lightsaber hilt, robes…' },
      },
    }),
  };
  const b = mapBackgroundRow(row);
  expect(b.featureName).toBe('Shelter of the Faithful');
  expect(b.skillProse).toContain('Choose two');
  expect(b.equipmentProse).toContain('lightsaber');
});

test('mapFeatRow, mapManeuverRow, mapGearRow', () => {
  const feat = mapFeatRow({ id: 'f', name: 'Ace Pilot', raw_json: JSON.stringify({ system: { description: { value: '<p>Fly good.</p>' }, requirements: null } }) });
  expect(feat).toMatchObject({ id: 'f', name: 'Ace Pilot', requirements: null });
  const man = mapManeuverRow({ id: 'm', name: 'Feint', raw_json: JSON.stringify({ system: { maneuverType: 'physical', description: { value: 'x' } } }) });
  expect(man.maneuverType).toBe('physical');
  const gear = mapGearRow({ id: 'g', name: 'Backpack', category: 'adventuring', raw_json: JSON.stringify({ system: { price: { value: 50 }, description: { value: 'Holds stuff' } } }) });
  expect(gear).toMatchObject({ id: 'g', category: 'adventuring', price: 50 });
});

test('weapon/armor rows now carry price and description', () => {
  const armorRow = { id: 'b', name: 'Beskar', raw_json: JSON.stringify({ system: { armor: { value: 14, type: 'medium', dex: 2 }, price: { value: 2000 }, description: { value: 'Shiny' } } }) };
  expect(mapArmorRow(armorRow)).toMatchObject({ baseAc: 14, price: 2000, description: 'Shiny' });
});

test('mapClassRow exposes identifier and sorted asiLevels from advancement', () => {
  const row = {
    id: 'c1', name: 'Fighter',
    raw_json: JSON.stringify({ system: {
      identifier: 'fighter', hitDice: 'd10', saves: ['str', 'con'],
      advancement: [
        { type: 'AbilityScoreImprovement', level: 19 },
        { type: 'HitPoints' },
        { type: 'AbilityScoreImprovement', level: 4 },
        { type: 'AbilityScoreImprovement', level: 6 },
      ],
    } }),
  };
  expect(mapClassRow(row)).toMatchObject({ identifier: 'fighter', asiLevels: [4, 6, 19] });
});

test('mapClassRow defaults identifier/asiLevels when data is missing', () => {
  const row = { id: 'c2', name: 'Mystery', raw_json: JSON.stringify({ system: {} }) };
  expect(mapClassRow(row)).toMatchObject({ identifier: '', asiLevels: [] });
});

test('mapArchetypeRow exposes classIdentifier and description', () => {
  const row = {
    id: 'a1', name: 'Sage Pursuant',
    raw_json: JSON.stringify({ system: {
      classIdentifier: 'consular',
      description: { value: '<p>A sage.</p>' },
    } }),
  };
  expect(mapArchetypeRow(row)).toMatchObject({ classIdentifier: 'consular', description: 'A sage.' });
});
