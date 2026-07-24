// apps/backend/src/routes/swdnd/encounters.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';

const MonsterEntry = z.object({ monsterId: z.string().min(1), count: z.number().int().min(1) });
const Encounter = z.object({
  id: z.string(), campaign_id: z.string(), name: z.string(),
  monsters_json: z.array(MonsterEntry), sort: z.number(),
  created_at: z.string(), updated_at: z.string(),
}).openapi('SwdndEncounter');

const PostBody = z.object({
  name: z.string().min(1),
  monsters: z.array(MonsterEntry).optional(),
}).openapi('SwdndPostEncounter');
const PatchBody = z.object({
  name: z.string().min(1).optional(),
  monsters: z.array(MonsterEntry).optional(),
  sort: z.number().int().optional(),
}).openapi('SwdndPatchEncounter');
const ErrorBody = z.object({ message: z.string() });

interface EncounterRow {
  id: string; campaign_id: string; name: string; monsters_json: string;
  sort: number; created_at: string; updated_at: string;
}

const encounterOut = (row: EncounterRow) => ({ ...row, monsters_json: JSON.parse(row.monsters_json || '[]') });
const getRow = (id: string): EncounterRow | null =>
  swdndDb.query<EncounterRow, [string]>('SELECT * FROM encounter WHERE id = ?').get(id) ?? null;

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/encounters', tags: ['swdnd'],
  summary: 'List encounter groups for a campaign',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Encounters', content: { 'application/json': { schema: z.array(Encounter) } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const postRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/encounters', tags: ['swdnd'],
  summary: 'Create an encounter group (DM only via the blanket gate)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PostBody } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Encounter } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const patchRoute = createRoute({
  method: 'patch', path: '/swdnd/encounters/{id}', tags: ['swdnd'],
  summary: 'Update an encounter group (DM only via the blanket gate)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PatchBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Encounter } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/encounters/{id}', tags: ['swdnd'],
  summary: 'Delete an encounter group (DM only via the blanket gate)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerEncounterRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id: campaignId } = c.req.valid('param');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });
    const rows = swdndDb
      .query<EncounterRow, [string]>('SELECT * FROM encounter WHERE campaign_id = ? ORDER BY sort ASC, created_at ASC')
      .all(campaignId);
    return c.json(rows.map(encounterOut), 200);
  });

  app.openapi(postRoute, (c) => {
    // /swdnd/campaigns/:id/encounters matches no selfGated clause — the
    // blanket admin gate already rejected non-admin mutations.
    const { id: campaignId } = c.req.valid('param');
    const { name, monsters } = c.req.valid('json');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO encounter (id, campaign_id, name, monsters_json, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [id, campaignId, name, JSON.stringify(monsters ?? []), now, now],
    );
    return c.json(encounterOut(getRow(id)!), 201);
  });

  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Encounter not found' });
    const now = new Date().toISOString();
    swdndDb.run(
      'UPDATE encounter SET name = ?, monsters_json = ?, sort = ?, updated_at = ? WHERE id = ?',
      [
        body.name ?? row.name,
        body.monsters !== undefined ? JSON.stringify(body.monsters) : row.monsters_json,
        body.sort ?? row.sort,
        now,
        id,
      ],
    );
    return c.json(encounterOut(getRow(id)!), 200);
  });

  app.openapi(deleteRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!getRow(id)) throw new HTTPException(404, { message: 'Encounter not found' });
    swdndDb.run('DELETE FROM encounter WHERE id = ?', [id]);
    return c.json({ ok: true }, 200);
  });
}
