// apps/backend/src/routes/swdnd/templates.test.ts
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
let otherCampaignToken: string;

beforeAll(async () => {
  // swdndDb and process.env are shared across test files in one bun process;
  // gate.test.ts sets ASHERCARLOW_AUTH_TOKEN and doesn't restore it, so defensively
  // clear it here too (same pattern as access.test.ts/characters.test.ts/players.test.ts/tokens.test.ts).
  delete process.env.ASHERCARLOW_AUTH_TOKEN;
  swdndDb.exec(
    'DELETE FROM template; DELETE FROM token; DELETE FROM scene; DELETE FROM character; DELETE FROM player; DELETE FROM campaign;',
  );
  campaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'T' }))).json()) as any).id;
  const p1 = (await (await app.request(`/swdnd/campaigns/${campaignId}/players`, json('POST', { name: 'P1' }))).json()) as any;
  playerToken = p1.access_token;
  sceneId = ((await (await app.request(`/swdnd/campaigns/${campaignId}/scenes`, json('POST', { name: 'S' }))).json()) as any).id;

  // A second campaign + player, used only for the auth-matrix "other campaign" cases.
  const otherCampaignId = ((await (await app.request('/swdnd/campaigns', json('POST', { name: 'Other' }))).json()) as any).id;
  const p2 = (await (await app.request(`/swdnd/campaigns/${otherCampaignId}/players`, json('POST', { name: 'P2' }))).json()) as any;
  otherCampaignToken = p2.access_token;
});

// Route tests run in dev mode (no ASHERCARLOW_AUTH_TOKEN), where admin/member checks
// pass for everyone. To exercise the member-vs-stranger matrix we temporarily set
// the env var so assertCampaignMember actually discriminates.
const withAuthEnv = async (fn: () => Promise<void>) => {
  process.env.ASHERCARLOW_AUTH_TOKEN = 'test-admin-secret';
  try { await fn(); } finally { delete process.env.ASHERCARLOW_AUTH_TOKEN; }
};

describe('swdnd templates', () => {
  it('creates a blast template; response has id/kind/q/r/size; GET lists it', async () => {
    const res = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', {
      kind: 'blast', q: 2, r: -1, size: 3,
    }));
    expect(res.status).toBe(201);
    const t = (await res.json()) as any;
    expect(t.id).toBeString();
    expect(t.kind).toBe('blast');
    expect(t.q).toBe(2);
    expect(t.r).toBe(-1);
    expect(t.size).toBe(3);

    const list = await app.request(`/swdnd/scenes/${sceneId}/templates`);
    expect(list.status).toBe(200);
    const templates = (await list.json()) as any[];
    expect(templates.some((x) => x.id === t.id)).toBe(true);
  });

  it('cone requires dir 0-5', async () => {
    const bad = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', {
      kind: 'cone', q: 0, r: 0, dir: 9, size: 2,
    }));
    expect(bad.status).toBe(400);

    const good = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', {
      kind: 'cone', q: 0, r: 0, dir: 3, size: 2,
    }));
    expect(good.status).toBe(201);
    expect(((await good.json()) as any).dir).toBe(3);
  });

  it('line stores q2/r2', async () => {
    const res = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', {
      kind: 'line', q: 0, r: 0, q2: 4, r2: 4,
    }));
    expect(res.status).toBe(201);
    const t = (await res.json()) as any;
    expect(t.q2).toBe(4);
    expect(t.r2).toBe(4);
  });

  it('auth matrix: member vs stranger for create/delete/clear', async () => {
    await withAuthEnv(async () => {
      const created = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', {
        kind: 'blast', q: 1, r: 1, size: 1,
      }, { 'X-Player-Token': playerToken }));
      expect(created.status).toBe(201);
      const template = (await created.json()) as any;

      const forbiddenCreate = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', {
        kind: 'blast', q: 1, r: 1, size: 1,
      }, { 'X-Player-Token': otherCampaignToken }));
      expect(forbiddenCreate.status).toBe(403);

      const noAuthCreate = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', {
        kind: 'blast', q: 1, r: 1, size: 1,
      }));
      expect(noAuthCreate.status).toBe(403);

      const forbiddenDelete = await app.request(`/swdnd/templates/${template.id}`, json('DELETE', undefined, { 'X-Player-Token': otherCampaignToken }));
      expect(forbiddenDelete.status).toBe(403);

      const memberDelete = await app.request(`/swdnd/templates/${template.id}`, json('DELETE', undefined, { 'X-Player-Token': playerToken }));
      expect(memberDelete.status).toBe(200);

      const clearAsPlayer = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('DELETE', undefined, { 'X-Player-Token': playerToken }));
      expect(clearAsPlayer.status).toBe(403);

      const clearAsAdmin = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('DELETE', undefined, { Authorization: 'Bearer test-admin-secret' }));
      expect(clearAsAdmin.status).toBe(200);
    });
  });

  it('clear-all removes all templates for the scene', async () => {
    await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', { kind: 'blast', q: 0, r: 0, size: 1 }));
    await app.request(`/swdnd/scenes/${sceneId}/templates`, json('POST', { kind: 'blast', q: 1, r: 0, size: 1 }));
    const before = (await (await app.request(`/swdnd/scenes/${sceneId}/templates`)).json()) as any[];
    expect(before.length).toBeGreaterThan(0);

    const cleared = await app.request(`/swdnd/scenes/${sceneId}/templates`, json('DELETE'));
    expect(cleared.status).toBe(200);

    const after = (await (await app.request(`/swdnd/scenes/${sceneId}/templates`)).json()) as any[];
    expect(after).toEqual([]);
  });
});

afterAll(() => { delete process.env.ASHERCARLOW_AUTH_TOKEN; });
