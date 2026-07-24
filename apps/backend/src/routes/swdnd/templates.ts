// apps/backend/src/routes/swdnd/templates.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { assertAdmin, assertCampaignMember } from './access';
import { getSceneRow } from './scenes';

const Template = z.object({
  id: z.string(), scene_id: z.string(),
  kind: z.enum(['blast', 'cone', 'line']),
  q: z.number(), r: z.number(), dir: z.number(), size: z.number(),
  q2: z.number().nullable(), r2: z.number().nullable(),
  color: z.string(), created_at: z.string(),
}).openapi('SwdndTemplate');

const PostBody = z.object({
  kind: z.enum(['blast', 'cone', 'line']),
  q: z.number().int(), r: z.number().int(),
  dir: z.number().int().min(0).max(5).optional(),
  size: z.number().int().min(0).max(20).optional(),
  q2: z.number().int().optional(), r2: z.number().int().optional(),
  color: z.string().optional(),
}).openapi('SwdndPostTemplate');

const ErrorBody = z.object({ message: z.string() });

interface TemplateRow {
  id: string; scene_id: string; kind: string; q: number; r: number; dir: number;
  size: number; q2: number | null; r2: number | null; color: string; created_at: string;
}

const getRow = (id: string): TemplateRow | null =>
  swdndDb.query('SELECT * FROM template WHERE id = ?').get(id) as TemplateRow | null;

const listRoute = createRoute({
  method: 'get', path: '/swdnd/scenes/{id}/templates', tags: ['swdnd'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Templates', content: { 'application/json': { schema: z.array(Template) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const createRouteDef = createRoute({
  method: 'post', path: '/swdnd/scenes/{id}/templates', tags: ['swdnd'],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Template } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const PatchBody = z.object({
  q: z.number().int().optional(), r: z.number().int().optional(),
  q2: z.number().int().nullable().optional(), r2: z.number().int().nullable().optional(),
  dir: z.number().int().min(0).max(5).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).openapi('SwdndPatchTemplate');

const patchRoute = createRoute({
  method: 'patch', path: '/swdnd/templates/{id}', tags: ['swdnd'],
  summary: 'Move or recolor a template (any campaign member)',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PatchBody } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Template } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/templates/{id}', tags: ['swdnd'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const clearRoute = createRoute({
  method: 'delete', path: '/swdnd/scenes/{id}/templates', tags: ['swdnd'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Cleared', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerTemplateRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!getSceneRow(id)) throw new HTTPException(404, { message: 'Scene not found' });
    const rows = swdndDb.query('SELECT * FROM template WHERE scene_id = ? ORDER BY created_at').all(id) as TemplateRow[];
    return c.json(rows, 200);
  });

  app.openapi(createRouteDef, (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const scene = getSceneRow(id);
    if (!scene) throw new HTTPException(404, { message: 'Scene not found' });
    assertCampaignMember(c, scene.campaign_id);
    if (b.kind === 'line' && (b.q2 == null || b.r2 == null)) {
      throw new HTTPException(400, { message: 'line templates need q2/r2' });
    }
    const now = new Date().toISOString();
    const tid = crypto.randomUUID();
    swdndDb.run(
      `INSERT INTO template (id, scene_id, kind, q, r, dir, size, q2, r2, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tid, id, b.kind, b.q, b.r, b.dir ?? 0, b.size ?? 1, b.q2 ?? null, b.r2 ?? null, b.color ?? '#c792ea', now],
    );
    const row = getRow(tid)!;
    const room = roomForCampaign(scene.campaign_id);
    publishToRoom(room, { type: 'template:created', room, payload: row });
    return c.json(row, 201);
  });

  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Template not found' });
    const scene = getSceneRow(row.scene_id)!;
    assertCampaignMember(c, scene.campaign_id);
    swdndDb.run(
      'UPDATE template SET q = ?, r = ?, q2 = ?, r2 = ?, dir = ?, color = ? WHERE id = ?',
      [
        b.q ?? row.q, b.r ?? row.r,
        b.q2 !== undefined ? b.q2 : row.q2, b.r2 !== undefined ? b.r2 : row.r2,
        b.dir ?? row.dir, b.color ?? row.color, id,
      ],
    );
    const updated = getRow(id)!;
    const room = roomForCampaign(scene.campaign_id);
    publishToRoom(room, { type: 'template:updated', room, payload: updated });
    return c.json(updated, 200);
  });

  app.openapi(deleteRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Template not found' });
    const scene = getSceneRow(row.scene_id)!;
    assertCampaignMember(c, scene.campaign_id);
    swdndDb.run('DELETE FROM template WHERE id = ?', [id]);
    const room = roomForCampaign(scene.campaign_id);
    publishToRoom(room, { type: 'template:deleted', room, payload: { id } });
    return c.json({ ok: true }, 200);
  });

  app.openapi(clearRoute, (c) => {
    const { id } = c.req.valid('param');
    const scene = getSceneRow(id);
    if (!scene) throw new HTTPException(404, { message: 'Scene not found' });
    assertAdmin(c); // clear-all is DM-only even though the path is selfGated-exempt
    swdndDb.run('DELETE FROM template WHERE scene_id = ?', [id]);
    const room = roomForCampaign(scene.campaign_id);
    publishToRoom(room, { type: 'template:cleared', room, payload: { sceneId: id } });
    return c.json({ ok: true }, 200);
  });
}
