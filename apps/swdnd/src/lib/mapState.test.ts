import { test, expect } from 'bun:test';
import { applyMapEvent, emptyMapState, optimisticMove, type MapState } from './mapState';
import type { TokenDto } from './scenes';

const t = (id: string, q = 0, r = 0): TokenDto => ({
  id, scene_id: 's1', character_id: null, name: id, color: '#fff', faction: 'friendly',
  q, r, scale: 1, hp: null, max_hp: null, conditions_json: [], hidden: 0, image_path: null,
  created_at: '', updated_at: '',
});

test('token:created / token:updated / token:deleted merge into state', () => {
  let s = emptyMapState();
  s = applyMapEvent(s, { type: 'token:created', room: 'x', payload: t('a') });
  expect(Object.keys(s.tokens)).toEqual(['a']);
  s = applyMapEvent(s, { type: 'token:updated', room: 'x', payload: t('a', 3, -1) });
  expect(s.tokens.a.q).toBe(3);
  s = applyMapEvent(s, { type: 'token:deleted', room: 'x', payload: { id: 'a' } });
  expect(s.tokens.a).toBeUndefined();
});

test('token:updated is ignored while that token has a pending optimistic move (echo guard)', () => {
  let s = emptyMapState();
  s = applyMapEvent(s, { type: 'token:created', room: 'x', payload: t('a') });
  s = optimisticMove(s, 'a', 5, 5);
  expect(s.tokens.a.q).toBe(5);
  expect(s.pendingMoves.a).toBeDefined();
  // stale echo of an older position must not clobber the optimistic value
  s = applyMapEvent(s, { type: 'token:updated', room: 'x', payload: t('a', 1, 1) });
  expect(s.tokens.a.q).toBe(5);
  // confirming clears the pending flag; later updates apply again
  s = { ...s, pendingMoves: {} };
  s = applyMapEvent(s, { type: 'token:updated', room: 'x', payload: t('a', 2, 2) });
  expect(s.tokens.a.q).toBe(2);
});

test('token:drag ephemeral ghosts set and clear', () => {
  let s = emptyMapState();
  s = applyMapEvent(s, { type: 'token:drag', room: 'x', payload: { tokenId: 'a', x: 10, y: 20, done: false } });
  expect(s.dragGhosts.a).toEqual({ x: 10, y: 20 });
  s = applyMapEvent(s, { type: 'token:drag', room: 'x', payload: { tokenId: 'a', x: 0, y: 0, done: true } });
  expect(s.dragGhosts.a).toBeUndefined();
});

test('scene:updated replaces the scene when ids match; scene:activated flags a reload', () => {
  let s: MapState = { ...emptyMapState(), scene: { id: 's1' } as any };
  s = applyMapEvent(s, { type: 'scene:updated', room: 'x', payload: { id: 's1', name: 'New' } });
  expect((s.scene as any).name).toBe('New');
  s = applyMapEvent(s, { type: 'scene:updated', room: 'x', payload: { id: 'other', name: 'X' } });
  expect((s.scene as any).name).toBe('New'); // different scene ignored
  s = applyMapEvent(s, { type: 'scene:activated', room: 'x', payload: { id: 's2' } });
  expect(s.staleScene).toBe(true);
});
