// apps/backend/src/routes/swdnd/scenes.ts
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { seedCharacterTokens } from './tokens';

const Grid = z.object({
  orientation: z.enum(['flat', 'pointy']),
  hexSize: z.number().positive(),
  originX: z.number(),
  originY: z.number(),
  unitsPerHex: z.number().positive(),
  unitLabel: z.string(),
}).openapi('SwdndGrid');

export const DEFAULT_GRID = {
  orientation: 'pointy', hexSize: 32, originX: 0, originY: 0, unitsPerHex: 5, unitLabel: 'ft',
} as const;

const Scene = z.object({
  id: z.string(),
  campaign_id: z.string(),
  name: z.string(),
  image_path: z.string().nullable(),
  image_w: z.number().nullable(),
  image_h: z.number().nullable(),
  grid_json: Grid,
  fog_json: z.array(z.string()),
  initiative_json: z.unknown().nullable(),
  is_active: z.number(),
  sort: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi('SwdndScene');

interface SceneRow {
  id: string; campaign_id: string; name: string;
  image_path: string | null; image_w: number | null; image_h: number | null;
  grid_json: string; fog_json: string; initiative_json: string | null;
  is_active: number; sort: number; created_at: string; updated_at: string;
}

const ErrorBody = z.object({ message: z.string() });
const PostBody = z.object({ name: z.string().min(1) }).openapi('SwdndPostScene');
const PatchBody = z.object({
  name: z.string().min(1).optional(),
  grid: Grid.optional(),
  sort: z.number().optional(),
}).openapi('SwdndPatchScene');

/** Parse a DB row's JSON columns into the API shape. */
export function sceneOut(row: SceneRow) {
  return {
    ...row,
    grid_json: JSON.parse(row.grid_json || '{}'),
    fog_json: JSON.parse(row.fog_json || '[]'),
    initiative_json: row.initiative_json ? JSON.parse(row.initiative_json) : null,
  };
}

export function getSceneRow(id: string): SceneRow | null {
  return swdndDb.query<SceneRow, [string]>('SELECT * FROM scene WHERE id = ?').get(id) ?? null;
}

function broadcastScene(row: SceneRow, type: string): void {
  const room = roomForCampaign(row.campaign_id);
  publishToRoom(room, { type, room, payload: sceneOut(row) });
}

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/scenes', tags: ['swdnd'],
  summary: 'List a campaign’s scenes',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Scenes', content: { 'application/json': { schema: z.array(Scene) } } } },
});
const createSceneRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/scenes', tags: ['swdnd'],
  summary: 'Create a scene (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Scene } } },
    404: { description: 'No campaign', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const getRoute = createRoute({
  method: 'get', path: '/swdnd/scenes/{id}', tags: ['swdnd'],
  summary: 'Get one scene',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Scene', content: { 'application/json': { schema: Scene } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const patchRoute = createRoute({
  method: 'patch', path: '/swdnd/scenes/{id}', tags: ['swdnd'],
  summary: 'Update a scene’s name/grid/sort (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PatchBody } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Scene } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/scenes/{id}', tags: ['swdnd'],
  summary: 'Delete a scene (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const activateRoute = createRoute({
  method: 'post', path: '/swdnd/scenes/{id}/activate', tags: ['swdnd'],
  summary: 'Make this the campaign’s active scene (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Activated', content: { 'application/json': { schema: Scene } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const HEX_KEY = /^-?\d+,-?\d+$/;
const FogBody = z.object({
  reveal: z.array(z.string().regex(HEX_KEY)),
  hide: z.array(z.string().regex(HEX_KEY)),
}).openapi('SwdndFogPatch');

const fogRoute = createRoute({
  method: 'patch', path: '/swdnd/scenes/{id}/fog', tags: ['swdnd'],
  summary: 'Reveal/hide fog-of-war hexes (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: FogBody } } } },
  responses: {
    200: { description: 'Updated scene', content: { 'application/json': { schema: Scene } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const InitiativeEntry = z.object({ tokenId: z.string(), name: z.string(), roll: z.number() });
const Initiative = z.object({
  order: z.array(InitiativeEntry),
  activeIndex: z.number().int().min(0),
  round: z.number().int().min(1),
}).openapi('SwdndInitiative');
const InitiativeBody = z.object({ initiative: Initiative.nullable() }).openapi('SwdndPatchInitiative');

const initiativeRoute = createRoute({
  method: 'patch', path: '/swdnd/scenes/{id}/initiative', tags: ['swdnd'],
  summary: 'Set or clear the scene’s initiative tracker (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: InitiativeBody } } } },
  responses: {
    200: { description: 'Updated scene', content: { 'application/json': { schema: Scene } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const UPLOADS_DIR = () => process.env.SWDND_UPLOADS_DIR ?? './data/uploads/swdnd';
const MAX_UPLOAD = 10 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const SAFE_FILE = /^[A-Za-z0-9-]+\.(png|jpg|webp)$/;

const uploadRoute = createRoute({
  method: 'post', path: '/swdnd/scenes/{id}/image', tags: ['swdnd'],
  summary: 'Upload the scene’s map image (multipart: file, w, h; DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Scene with image', content: { 'application/json': { schema: Scene } } },
    400: { description: 'Bad upload', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const serveRoute = createRoute({
  method: 'get', path: '/swdnd/uploads/{file}', tags: ['swdnd'],
  summary: 'Serve an uploaded map image',
  request: { params: z.object({ file: z.string() }) },
  responses: { 200: { description: 'The image' }, 404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } } },
});

export function registerSceneRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    const rows = swdndDb
      .query<SceneRow, [string]>('SELECT * FROM scene WHERE campaign_id = ? ORDER BY sort, created_at')
      .all(id);
    return c.json(rows.map(sceneOut), 200);
  });

  app.openapi(createSceneRoute, (c) => {
    const { id: campaignId } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO scene (id, campaign_id, name, grid_json, fog_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, campaignId, name, JSON.stringify(DEFAULT_GRID), '[]', now, now],
    );
    seedCharacterTokens(id, campaignId);
    const row = getSceneRow(id)!;
    broadcastScene(row, 'scene:updated');
    return c.json(sceneOut(row), 201);
  });

  app.openapi(getRoute, (c) => {
    const row = getSceneRow(c.req.valid('param').id);
    if (!row) throw new HTTPException(404, { message: 'Scene not found' });
    return c.json(sceneOut(row), 200);
  });

  app.openapi(patchRoute, (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = getSceneRow(id);
    if (!row) throw new HTTPException(404, { message: 'Scene not found' });
    const now = new Date().toISOString();
    swdndDb.run(
      'UPDATE scene SET name = ?, grid_json = ?, sort = ?, updated_at = ? WHERE id = ?',
      [
        body.name ?? row.name,
        body.grid ? JSON.stringify(body.grid) : row.grid_json,
        body.sort ?? row.sort,
        now, id,
      ],
    );
    const updated = getSceneRow(id)!;
    broadcastScene(updated, 'scene:updated');
    return c.json(sceneOut(updated), 200);
  });

  app.openapi(deleteRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getSceneRow(id);
    if (!row) throw new HTTPException(404, { message: 'Scene not found' });
    swdndDb.run('DELETE FROM scene WHERE id = ?', [id]);
    const room = roomForCampaign(row.campaign_id);
    publishToRoom(room, { type: 'scene:deleted', room, payload: { id } });
    return c.json({ ok: true }, 200);
  });

  app.openapi(activateRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getSceneRow(id);
    if (!row) throw new HTTPException(404, { message: 'Scene not found' });
    const now = new Date().toISOString();
    swdndDb.transaction(() => {
      swdndDb.run('UPDATE scene SET is_active = 0 WHERE campaign_id = ?', [row.campaign_id]);
      swdndDb.run('UPDATE scene SET is_active = 1, updated_at = ? WHERE id = ?', [now, id]);
    })();
    const updated = getSceneRow(id)!;
    broadcastScene(updated, 'scene:activated');
    return c.json(sceneOut(updated), 200);
  });

  app.openapi(fogRoute, (c) => {
    const { id } = c.req.valid('param');
    const { reveal, hide } = c.req.valid('json');
    const row = getSceneRow(id);
    if (!row) throw new HTTPException(404, { message: 'Scene not found' });
    // Same semantics as the client's lib/fog.ts: hide wins ties, dedupe, sort.
    const set = new Set<string>(JSON.parse(row.fog_json || '[]') as string[]);
    for (const k of reveal) set.add(k);
    for (const k of hide) set.delete(k);
    const now = new Date().toISOString();
    swdndDb.run('UPDATE scene SET fog_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify([...set].sort()), now, id]);
    const updated = getSceneRow(id)!;
    broadcastScene(updated, 'scene:updated');
    return c.json(sceneOut(updated), 200);
  });

  app.openapi(initiativeRoute, (c) => {
    const { id } = c.req.valid('param');
    const { initiative } = c.req.valid('json');
    const row = getSceneRow(id);
    if (!row) throw new HTTPException(404, { message: 'Scene not found' });
    const now = new Date().toISOString();
    swdndDb.run(
      'UPDATE scene SET initiative_json = ?, updated_at = ? WHERE id = ?',
      [initiative === null ? null : JSON.stringify(initiative), now, id],
    );
    const updated = getSceneRow(id)!;
    broadcastScene(updated, 'scene:updated');
    return c.json(sceneOut(updated), 200);
  });

  app.openapi(uploadRoute, async (c) => {
    const { id } = c.req.valid('param');
    const row = getSceneRow(id);
    if (!row) throw new HTTPException(404, { message: 'Scene not found' });
    const body = await c.req.parseBody();
    const file = body.file;
    const w = Number(body.w);
    const h = Number(body.h);
    if (!(file instanceof File)) throw new HTTPException(400, { message: 'Missing file' });
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new HTTPException(400, { message: 'Missing image dimensions (w, h)' });
    }
    const ext = EXT_BY_MIME[file.type];
    if (!ext) throw new HTTPException(400, { message: 'Only png/jpg/webp images are allowed' });
    if (file.size > MAX_UPLOAD) throw new HTTPException(400, { message: 'Image exceeds 10 MB' });

    mkdirSync(UPLOADS_DIR(), { recursive: true });
    const filename = `${id}.${ext}`;
    await Bun.write(join(UPLOADS_DIR(), filename), file);
    for (const otherExt of Object.values(EXT_BY_MIME)) {
      if (otherExt === ext) continue;
      const stalePath = join(UPLOADS_DIR(), `${id}.${otherExt}`);
      if (await Bun.file(stalePath).exists()) await unlink(stalePath);
    }
    const now = new Date().toISOString();
    swdndDb.run(
      'UPDATE scene SET image_path = ?, image_w = ?, image_h = ?, updated_at = ? WHERE id = ?',
      [filename, Math.round(w), Math.round(h), now, id],
    );
    const updated = getSceneRow(id)!;
    broadcastScene(updated, 'scene:updated');
    return c.json(sceneOut(updated), 200);
  });

  app.openapi(serveRoute, async (c) => {
    const { file } = c.req.valid('param');
    if (!SAFE_FILE.test(file)) throw new HTTPException(404, { message: 'Not found' });
    const f = Bun.file(join(UPLOADS_DIR(), file));
    if (!(await f.exists())) throw new HTTPException(404, { message: 'Not found' });
    return new Response(f, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } });
  });
}
