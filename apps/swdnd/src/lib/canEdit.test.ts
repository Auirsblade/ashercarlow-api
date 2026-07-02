// apps/swdnd/src/lib/canEdit.test.ts
import { test, expect } from 'bun:test';
import { resolveCanEdit } from './canEdit';

test('admin or a present token grants edit; neither is read-only', () => {
  expect(resolveCanEdit({ admin: true, token: null })).toBe(true);
  expect(resolveCanEdit({ admin: false, token: 'tok-1' })).toBe(true);
  expect(resolveCanEdit({ admin: false, token: null })).toBe(false);
  expect(resolveCanEdit({ admin: false, token: '' })).toBe(false);
});
