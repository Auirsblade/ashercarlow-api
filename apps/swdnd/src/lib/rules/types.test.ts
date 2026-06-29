// apps/swdnd/src/lib/rules/types.test.ts
import { test, expect } from 'bun:test';
import { emptyBuild, type CharacterBuild } from './types';

test('emptyBuild produces a schema-versioned, playable blank build', () => {
  const b: CharacterBuild = emptyBuild('Lyra Voss');
  expect(b.schemaVersion).toBe(1);
  expect(b.identity.name).toBe('Lyra Voss');
  expect(b.identity.alignment).toBe('none');
  expect(b.abilities.base).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
  expect(b.levels).toEqual([]);
  expect(b.play.hp).toBe(0);
  expect(b.overrides).toEqual({});
});
