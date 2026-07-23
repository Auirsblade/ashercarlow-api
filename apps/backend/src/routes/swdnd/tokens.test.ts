// apps/backend/src/routes/swdnd/tokens.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createApiApp } from '../../lib/openapi';
import { swdndDb } from '../../db/swdnd';

const app = createApiApp();
const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

let campaignId: string;
let sceneId: string;
let playerToken: string;
let otherToken: string;
let pcTokenId: string;

beforeAll(async () => {
  // swdndDb and process.env are shared across test files in one bun process;
  // gate.test.ts sets ASHERCARLOW_AUTH_TOKEN and doesn't restore it, so defensively
  // clear it here too (same pattern as access.test.ts/characters.test.ts/players.test.ts).
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
  swdndDb.exec('DELETE FROM token; DELETE FROM scene; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;');
  campaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'T' }))).json()) as any).id;
  const p1 = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'P1' }))).json()) as any;
  const p2 = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'P2' }))).json()) as any;
  playerToken = p1.access_token;
  otherToken = p2.access_token;
  // P1 claims a character
  await app.request(`/swdnd/campaigns/${campaignId}/characters?token=${playerToken}`, json('POST', { name: 'Hero' }));
  // scene AFTER the character exists → seeding covers it
  sceneId = ((await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'S' }))).json()) as any).id;
});

// Route tests run in dev mode (no ASHERCARLOW_AUTH_TOKEN), where admin checks
// pass for everyone. To exercise the player-vs-player matrix we temporarily set
// the env var so assertTokenMoveAccess actually discriminates.
const withAuthEnv = async (fn: () => Promise<void>) => {
  process.env.ASHERCARLOW_AUTH_TOKEN = 'test-admin-secret';
  try { await fn(); } finally { delete process.env.ASHERCARLOW_AUTH_TOKEN; }
};

describe('swdnd tokens', () => {
  it('scene creation seeded a friendly token for the existing character', async () => {
    const res = await app.request(`/swdnd/scenes/${sceneId}/tokens`);
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as any[];
    expect(tokens).toHaveLength(1);
    expect(tokens[0].name).toBe('Hero');
    expect(tokens[0].faction).toBe('friendly');
    expect(tokens[0].character_id).not.toBeNull();
    pcTokenId = tokens[0].id;
  });

  it('DM creates an ad-hoc hostile token', async () => {
    const res = await app.request(`/swdnd/scenes/${sceneId}/tokens`, json('POST', {
      name: 'B1 Droid', color: '#ff5470', faction: 'hostile', q: 4, r: -2, hp: 12, max_hp: 12,
    }));
    expect(res.status).toBe(201);
    const t = (await res.json()) as any;
    expect(t.faction).toBe('hostile');
    expect(t.q).toBe(4);
  });

  it('PATCH updates token fields; DELETE removes; 404 unknown', async () => {
    const res = await app.request(`/swdnd/tokens/${pcTokenId}`, json('PATCH', { color: '#7aa2ff', scale: 2 }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).scale).toBe(2);
    const doomed = (await (await app.request(`/swdnd/scenes/${sceneId}/tokens`, json('POST', { name: 'X' }))).json()) as any;
    expect((await app.request(`/swdnd/tokens/${doomed.id}`, json('DELETE'))).status).toBe(200);
    expect((await app.request(`/swdnd/tokens/nope/position`, json('PATCH', { q: 0, r: 0 }))).status).toBe(404);
  });

  it('position: owner moves own token; stranger and cross-player are 403; admin bearer moves anything', async () => {
    await withAuthEnv(async () => {
      const own = await app.request(`/swdnd/tokens/${pcTokenId}/position`, json('PATCH', { q: 1, r: 1 }, { 'X-Player-Token': playerToken }));
      expect(own.status).toBe(200);
      expect(((await own.json()) as any).q).toBe(1);

      expect((await app.request(`/swdnd/tokens/${pcTokenId}/position`, json('PATCH', { q: 2, r: 2 }, { 'X-Player-Token': otherToken }))).status).toBe(403);
      expect((await app.request(`/swdnd/tokens/${pcTokenId}/position`, json('PATCH', { q: 2, r: 2 }))).status).toBe(403);

      const admin = await app.request(`/swdnd/tokens/${pcTokenId}/position`, json('PATCH', { q: 5, r: 5 }, { Authorization: 'Bearer test-admin-secret' }));
      expect(admin.status).toBe(200);
    });
  });

  it('with auth enabled, token PATCH/DELETE stay admin-only despite the selfGated exemption', async () => {
    await withAuthEnv(async () => {
      expect((await app.request(`/swdnd/tokens/${pcTokenId}`, json('PATCH', { color: '#fff' }, { 'X-Player-Token': playerToken }))).status).toBe(403);
      expect((await app.request(`/swdnd/tokens/${pcTokenId}`, json('DELETE', undefined, { 'X-Player-Token': playerToken }))).status).toBe(403);
    });
  });
});

afterAll(() => { delete process.env.ASHERCARLOW_AUTH_TOKEN; });
