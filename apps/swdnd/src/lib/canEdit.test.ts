// apps/swdnd/src/lib/canEdit.test.ts
import { describe, test, expect } from 'bun:test';
import { resolveCanEdit, resolveShipCanEdit } from './canEdit';

test('admin or a present token grants edit; neither is read-only', () => {
  expect(resolveCanEdit({ admin: true, token: null })).toBe(true);
  expect(resolveCanEdit({ admin: false, token: 'tok-1' })).toBe(true);
  expect(resolveCanEdit({ admin: false, token: null })).toBe(false);
  expect(resolveCanEdit({ admin: false, token: '' })).toBe(false);
});

describe('resolveShipCanEdit', () => {
  const crew = [{ character_id: 'ch1' }, { character_id: 'ch2' }];

  test('the admin always edits, with or without a token', () => {
    expect(resolveShipCanEdit({ admin: true, token: null, playerCharacterIds: [], crew })).toBe(true);
    expect(resolveShipCanEdit({ admin: true, token: 'x', playerCharacterIds: [], crew: [] })).toBe(true);
  });

  test('a player edits only when one of their characters crews the ship', () => {
    expect(resolveShipCanEdit({ admin: false, token: 't', playerCharacterIds: ['ch2'], crew })).toBe(true);
    expect(resolveShipCanEdit({ admin: false, token: 't', playerCharacterIds: ['ch9'], crew })).toBe(false);
    expect(resolveShipCanEdit({ admin: false, token: 't', playerCharacterIds: [], crew })).toBe(false);
  });

  test('no token means no player identity, so no edit', () => {
    expect(resolveShipCanEdit({ admin: false, token: null, playerCharacterIds: ['ch1'], crew })).toBe(false);
  });

  test('an empty roster is editable by nobody but the admin', () => {
    expect(resolveShipCanEdit({ admin: false, token: 't', playerCharacterIds: ['ch1'], crew: [] })).toBe(false);
  });
});
