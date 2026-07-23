import { describe, it, test, expect } from 'bun:test';
import { applyMapEvent, confirmMove, emptyMapState, optimisticMove, rollbackMove, type MapState } from './mapState';
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
  const { state } = optimisticMove(s, 'a', 5, 5);
  s = state;
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

test('optimisticMove assigns an incrementing seq per token', () => {
  let s = emptyMapState();
  s = applyMapEvent(s, { type: 'token:created', room: 'x', payload: t('a') });
  const moveA = optimisticMove(s, 'a', 1, 1);
  s = moveA.state;
  expect(s.pendingMoves.a).toEqual({ q: 1, r: 1, seq: moveA.seq });
  const moveB = optimisticMove(s, 'a', 2, 2);
  s = moveB.state;
  expect(s.pendingMoves.a).toEqual({ q: 2, r: 2, seq: moveB.seq });
  expect(moveB.seq).toBeGreaterThan(moveA.seq);
});

test('confirmMove of a superseded (older) seq is a no-op; the newer pending entry survives', () => {
  let s = emptyMapState();
  s = applyMapEvent(s, { type: 'token:created', room: 'x', payload: t('a') });
  const moveA = optimisticMove(s, 'a', 1, 1);
  s = moveA.state;
  const moveB = optimisticMove(s, 'a', 2, 2);
  s = moveB.state;

  // REST confirm for the OLDER move A arrives after B was already issued optimistically.
  s = confirmMove(s, 'a', moveA.seq);
  expect(s.pendingMoves.a).toBeDefined(); // guard for B must still be up
  expect(s.tokens.a.q).toBe(2);

  // The WS echo for A's move (position 1,1) must still be dropped by the guard.
  s = applyMapEvent(s, { type: 'token:updated', room: 'x', payload: t('a', 1, 1) });
  expect(s.tokens.a.q).toBe(2);

  // Confirming B clears the guard.
  s = confirmMove(s, 'a', moveB.seq);
  expect(s.pendingMoves.a).toBeUndefined();

  // Later updates apply normally again.
  s = applyMapEvent(s, { type: 'token:updated', room: 'x', payload: t('a', 3, 3) });
  expect(s.tokens.a.q).toBe(3);
});

test('rollbackMove of a superseded (older) seq is a no-op — does not revert the newer optimistic position', () => {
  let s = emptyMapState();
  s = applyMapEvent(s, { type: 'token:created', room: 'x', payload: t('a') });
  const moveA = optimisticMove(s, 'a', 1, 1);
  s = moveA.state;
  const moveB = optimisticMove(s, 'a', 2, 2);
  s = moveB.state;

  // REST for A failed and tries to roll back to the pre-A position (0,0) — but B has since
  // been optimistically applied, so this must be a no-op.
  s = rollbackMove(s, 'a', moveA.seq, 0, 0);
  expect(s.tokens.a.q).toBe(2);
  expect(s.pendingMoves.a).toEqual({ q: 2, r: 2, seq: moveB.seq });
});

test('rollbackMove of the current (latest) seq reverts position and clears the guard', () => {
  let s = emptyMapState();
  s = applyMapEvent(s, { type: 'token:created', room: 'x', payload: t('a') });
  const moveA = optimisticMove(s, 'a', 5, 5);
  s = moveA.state;
  s = rollbackMove(s, 'a', moveA.seq, 0, 0);
  expect(s.tokens.a.q).toBe(0);
  expect(s.pendingMoves.a).toBeUndefined();
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

describe('template events', () => {
  it('template:created adds and template:deleted removes', () => {
    const tpl = { id: 'T1', scene_id: 'S', kind: 'blast', q: 0, r: 0, dir: 0, size: 1, q2: null, r2: null, color: '#fff', created_at: '' };
    let s = applyMapEvent(emptyMapState(), { type: 'template:created', room: 'x', payload: tpl });
    expect(s.templates.T1).toEqual(tpl);
    s = applyMapEvent(s, { type: 'template:deleted', room: 'x', payload: { id: 'T1' } });
    expect(s.templates.T1).toBeUndefined();
  });

  it('template:cleared empties only for the matching scene', () => {
    const tpl = { id: 'T1', scene_id: 'S', kind: 'blast', q: 0, r: 0, dir: 0, size: 1, q2: null, r2: null, color: '#fff', created_at: '' };
    let s = applyMapEvent(emptyMapState(), { type: 'template:created', room: 'x', payload: tpl });
    s = { ...s, scene: { id: 'S' } as unknown as import('./scenes').SceneDto };
    const other = applyMapEvent(s, { type: 'template:cleared', room: 'x', payload: { sceneId: 'OTHER' } });
    expect(Object.keys(other.templates).length).toBe(1);
    const cleared = applyMapEvent(s, { type: 'template:cleared', room: 'x', payload: { sceneId: 'S' } });
    expect(cleared.templates).toEqual({});
  });
});
