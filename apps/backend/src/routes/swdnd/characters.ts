// apps/backend/src/routes/swdnd/characters.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { assertCharacterWriteAccess, resolvePlayerByToken, playerTokenFrom } from './access';

const Character = z
  .object({
    id: z.string(),
    campaign_id: z.string(),
    player_id: z.string().nullable(),
    name: z.string(),
    data_json: z.record(z.any()),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('SwdndCharacter');

interface CharacterRow {
  id: string;
  campaign_id: string;
  player_id: string | null;
  name: string;
  data_json: string;
  created_at: string;
  updated_at: string;
}

const ErrorBody = z.object({ message: z.string() });
const PostBody = z.object({ name: z.string().min(1) }).openapi('SwdndPostCharacter');
const PatchBody = z
  .object({ name: z.string().min(1).optional(), data_json: z.record(z.any()).optional() })
  .openapi('SwdndPatchCharacter');

function toApi(row: CharacterRow) {
  return { ...row, data_json: JSON.parse(row.data_json) as Record<string, unknown> };
}
function emptyBuildJson(name: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    identity: { name, speciesId: '', backgroundId: '', alignment: 'none' },
    abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, increases: [] },
    levels: [],
    proficiencies: { skills: [], expertise: [], tools: [], languages: [], savingThrows: [] },
    equipment: [], credits: 0, knownPowers: [], knownManeuvers: [],
    play: { hp: 0, tempHp: 0, hitDiceSpent: 0, forcePointsSpent: 0, techPointsSpent: 0, superiorityDiceSpent: 0, conditions: [], exhaustion: 0, inspiration: false, notes: '' },
    overrides: {},
  });
}
function getRow(id: string): CharacterRow | null {
  return swdndDb.query<CharacterRow, [string]>('SELECT * FROM character WHERE id = ?').get(id) ?? null;
}

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/characters', tags: ['swdnd'],
  summary: 'List characters in a campaign',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Characters', content: { 'application/json': { schema: z.array(Character) } } } },
});

const getRoute = createRoute({
  method: 'get', path: '/swdnd/characters/{id}', tags: ['swdnd'], summary: 'Get one character',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Character', content: { 'application/json': { schema: Character } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const postRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/characters', tags: ['swdnd'],
  summary: 'Create a character (admin or a player in the campaign)',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Character } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const patchRoute = createRoute({
  method: 'patch', path: '/swdnd/characters/{id}', tags: ['swdnd'],
  summary: 'Update a character build/play state; broadcasts to the campaign room',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PatchBody } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Character } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/characters/{id}', tags: ['swdnd'], summary: 'Delete a character',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerCharacterRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    const rows = swdndDb
      .query<CharacterRow, [string]>('SELECT * FROM character WHERE campaign_id = ? ORDER BY created_at ASC')
      .all(id);
    return c.json(rows.map(toApi), 200);
  });

  app.openapi(getRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Character not found' });
    return c.json(toApi(row), 200);
  });

  app.openapi(postRoute, (c) => {
    const { id: campaignId } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });

    // A player creating a character is the owner; admin/dev creates an unassigned one.
    const player = resolvePlayerByToken(playerTokenFrom(c));
    const playerId = player && player.campaign_id === campaignId ? player.id : null;
    if (process.env.ASHERCARLOW_AUTH_TOKEN && !playerId) assertCharacterWriteAccess(c, { player_id: null });

    const now = new Date().toISOString();
    const charId = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO character (id, campaign_id, player_id, name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [charId, campaignId, playerId, name, emptyBuildJson(name), now, now],
    );
    return c.json(toApi(getRow(charId)!), 201);
  });

  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Character not found' });
    assertCharacterWriteAccess(c, row);

    const now = new Date().toISOString();
    const name = body.name ?? row.name;
    const dataJson = body.data_json !== undefined ? JSON.stringify(body.data_json) : row.data_json;
    swdndDb.run('UPDATE character SET name = ?, data_json = ?, updated_at = ? WHERE id = ?', [name, dataJson, now, id]);

    const updated = toApi(getRow(id)!);
    const room = roomForCampaign(row.campaign_id);
    publishToRoom(room, {
      type: 'character:updated', room,
      payload: { characterId: id, name: updated.name, play: (updated.data_json as { play?: unknown }).play },
    });
    return c.json(updated, 200);
  });

  app.openapi(deleteRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Character not found' });
    assertCharacterWriteAccess(c, row);
    swdndDb.run('DELETE FROM character WHERE id = ?', [id]);
    return c.json({ ok: true }, 200);
  });
}
