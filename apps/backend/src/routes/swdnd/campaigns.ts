import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';

const Campaign = z
  .object({
    id: z.string(),
    name: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('SwdndCampaign');

type CampaignRow = z.infer<typeof Campaign>;
const ErrorBody = z.object({ message: z.string() });
const PostBody = z.object({ name: z.string().min(1) }).openapi('SwdndPostCampaign');
const PatchBody = z.object({ name: z.string().min(1) }).openapi('SwdndPatchCampaign');

const listRoute = createRoute({
  method: 'get',
  path: '/swdnd/campaigns',
  tags: ['swdnd'],
  summary: 'List campaigns',
  responses: {
    200: { description: 'Campaigns', content: { 'application/json': { schema: z.array(Campaign) } } },
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/swdnd/campaigns/{id}',
  tags: ['swdnd'],
  summary: 'Get one campaign',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Campaign', content: { 'application/json': { schema: Campaign } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const postRoute = createRoute({
  method: 'post',
  path: '/swdnd/campaigns',
  tags: ['swdnd'],
  summary: 'Create a campaign (DM only)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Campaign } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/swdnd/campaigns/{id}',
  tags: ['swdnd'],
  summary: 'Rename a campaign (DM only); broadcasts to the campaign room',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PatchBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Campaign } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerCampaignRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const rows = swdndDb
      .query<CampaignRow, []>('SELECT id, name, created_at, updated_at FROM campaign ORDER BY created_at DESC')
      .all();
    return c.json(rows, 200);
  });

  app.openapi(getRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = swdndDb
      .query<CampaignRow, [string]>('SELECT id, name, created_at, updated_at FROM campaign WHERE id = ?')
      .get(id);
    if (!row) throw new HTTPException(404, { message: 'Campaign not found' });
    return c.json(row, 200);
  });

  app.openapi(postRoute, (c) => {
    const { name } = c.req.valid('json');
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO campaign (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, name, now, now],
    );
    return c.json({ id, name, created_at: now, updated_at: now }, 201);
  });

  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const existing = swdndDb
      .query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?')
      .get(id);
    if (!existing) throw new HTTPException(404, { message: 'Campaign not found' });

    const now = new Date().toISOString();
    swdndDb.run('UPDATE campaign SET name = ?, updated_at = ? WHERE id = ?', [name, now, id]);
    const updated = swdndDb
      .query<CampaignRow, [string]>('SELECT id, name, created_at, updated_at FROM campaign WHERE id = ?')
      .get(id)!;

    const room = roomForCampaign(id);
    publishToRoom(room, { type: 'campaign:updated', room, payload: updated });
    return c.json(updated, 200);
  });
}
