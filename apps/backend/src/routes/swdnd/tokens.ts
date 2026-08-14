// apps/backend/src/routes/swdnd/tokens.ts
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { assertAdmin, assertTokenMoveAccess } from './access';
import { getSceneRow } from './scenes';

const Token = z.object({
  id: z.string(),
  scene_id: z.string(),
  character_id: z.string().nullable(),
  ship_id: z.string().nullable(),
  name: z.string(),
  color: z.string(),
  faction: z.enum(['friendly', 'hostile', 'neutral']),
  q: z.number(),
  r: z.number(),
  scale: z.number(),
  facing: z.number(),
  hp: z.number().nullable(),
  max_hp: z.number().nullable(),
  conditions_json: z.array(z.string()),
  hidden: z.number(),
  image_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi('SwdndToken');

interface TokenRow {
  id: string; scene_id: string; character_id: string | null; ship_id: string | null;
  name: string; color: string; faction: string; q: number; r: number; scale: number;
  facing: number; hp: number | null; max_hp: number | null;
  conditions_json: string; hidden: number; image_path: string | null; created_at: string; updated_at: string;
}

const ErrorBody = z.object({ message: z.string() });
const PostBody = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  faction: z.enum(['friendly', 'hostile', 'neutral']).optional(),
  character_id: z.string().nullable().optional(),
  /** Binds this token's vitals to a starship (hull/shields/conditions live on the ship). */
  ship_id: z.string().nullable().optional(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  /** Hexes across. Ship footprints convert cells → span client-side (footprintScale). */
  scale: z.number().int().min(1).max(16).optional(),
  /** 0-5: index into the six axial hex directions. */
  facing: z.number().int().min(0).max(5).optional(),
  hp: z.number().nullable().optional(),
  max_hp: z.number().nullable().optional(),
}).openapi('SwdndPostToken');
const PatchBody = PostBody.partial().extend({
  conditions: z.array(z.string()).optional(),
  hidden: z.number().int().min(0).max(1).optional(),
}).openapi('SwdndPatchToken');
/** Move and/or rotate. Omitted fields keep their stored value, so a pure
 *  rotation can't rewrite position from a stale client copy. */
const PositionBody = z.object({
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  facing: z.number().int().min(0).max(5).optional(),
}).openapi('SwdndTokenPosition');

const UPLOADS_DIR = () => process.env.SWDND_UPLOADS_DIR ?? './data/uploads/swdnd';
const MAX_TOKEN_UPLOAD = 5 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const SAFE_FILE = /^[A-Za-z0-9-]+\.(png|jpg|webp)$/;

export function tokenOut(row: TokenRow) {
  return { ...row, conditions_json: JSON.parse(row.conditions_json || '[]') };
}
function getTokenRow(id: string): TokenRow | null {
  return swdndDb.query<TokenRow, [string]>('SELECT * FROM token WHERE id = ?').get(id) ?? null;
}
function campaignOfScene(sceneId: string): string | null {
  return getSceneRow(sceneId)?.campaign_id ?? null;
}
function broadcastToken(row: TokenRow, type: string): void {
  const campaignId = campaignOfScene(row.scene_id);
  if (!campaignId) return;
  const room = roomForCampaign(campaignId);
  publishToRoom(room, { type, room, payload: tokenOut(row) });
}

/** Insert one friendly token per campaign character into a new scene (spec: player tokens auto-exist). */
export function seedCharacterTokens(sceneId: string, campaignId: string): void {
  const chars = swdndDb
    .query<{ id: string; name: string }, [string]>('SELECT id, name FROM character WHERE campaign_id = ?')
    .all(campaignId);
  const now = new Date().toISOString();
  swdndDb.transaction(() => {
    chars.forEach((ch, i) => {
      swdndDb.run(
        `INSERT INTO token (id, scene_id, character_id, name, color, faction, q, r, conditions_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '#4dd0e1', 'friendly', ?, 0, '[]', ?, ?)`,
        [crypto.randomUUID(), sceneId, ch.id, ch.name, i, now, now],
      );
    });
  })();
}

const listRoute = createRoute({
  method: 'get', path: '/swdnd/scenes/{id}/tokens', tags: ['swdnd'],
  summary: 'List a scene’s tokens',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Tokens', content: { 'application/json': { schema: z.array(Token) } } },
    404: { description: 'No scene', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const createTokenRoute = createRoute({
  method: 'post', path: '/swdnd/scenes/{id}/tokens', tags: ['swdnd'],
  summary: 'Create a token (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Token } } },
    404: { description: 'No scene', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const patchRoute = createRoute({
  method: 'patch', path: '/swdnd/tokens/{id}', tags: ['swdnd'],
  summary: 'Update a token (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PatchBody } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Token } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const deleteRoute = createRoute({
  method: 'delete', path: '/swdnd/tokens/{id}', tags: ['swdnd'],
  summary: 'Delete a token (DM only)', security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const positionRoute = createRoute({
  method: 'patch', path: '/swdnd/tokens/{id}/position', tags: ['swdnd'],
  summary: 'Move or rotate a token (DM any; a player their own character’s or crewed ship’s token)',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PositionBody } } } },
  responses: {
    200: { description: 'Moved', content: { 'application/json': { schema: Token } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const uploadImageRoute = createRoute({
  method: 'post', path: '/swdnd/tokens/{id}/image', tags: ['swdnd'],
  summary: 'Upload a token image (multipart: file; DM any, a player their own character’s token)',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Token with image', content: { 'application/json': { schema: Token } } },
    400: { description: 'Bad upload', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});
const deleteImageRoute = createRoute({
  method: 'delete', path: '/swdnd/tokens/{id}/image', tags: ['swdnd'],
  summary: 'Remove a token image (reverts to the generated disc)',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Token without image', content: { 'application/json': { schema: Token } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerTokenRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!getSceneRow(id)) throw new HTTPException(404, { message: 'Scene not found' });
    const rows = swdndDb.query<TokenRow, [string]>('SELECT * FROM token WHERE scene_id = ? ORDER BY created_at').all(id);
    return c.json(rows.map(tokenOut), 200);
  });

  app.openapi(createTokenRoute, (c) => {
    const { id: sceneId } = c.req.valid('param');
    if (!getSceneRow(sceneId)) throw new HTTPException(404, { message: 'Scene not found' });
    const b = c.req.valid('json');
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    swdndDb.run(
      `INSERT INTO token (id, scene_id, character_id, ship_id, name, color, faction, q, r, scale, facing, hp, max_hp, conditions_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      [id, sceneId, b.character_id ?? null, b.ship_id ?? null, b.name, b.color ?? '#4dd0e1', b.faction ?? 'friendly',
       b.q ?? 0, b.r ?? 0, b.scale ?? 1, b.facing ?? 0, b.hp ?? null, b.max_hp ?? null, now, now],
    );
    const row = getTokenRow(id)!;
    broadcastToken(row, 'token:created');
    return c.json(tokenOut(row), 201);
  });

  app.openapi(patchRoute, (c) => {
    assertAdmin(c); // path is selfGated-exempt; enforce here
    const { id } = c.req.valid('param');
    const row = getTokenRow(id);
    if (!row) throw new HTTPException(404, { message: 'Token not found' });
    const b = c.req.valid('json');
    const now = new Date().toISOString();
    swdndDb.run(
      `UPDATE token SET name = ?, color = ?, faction = ?, character_id = ?, ship_id = ?, q = ?, r = ?, scale = ?,
         facing = ?, hp = ?, max_hp = ?, conditions_json = ?, hidden = ?, updated_at = ? WHERE id = ?`,
      [b.name ?? row.name, b.color ?? row.color, b.faction ?? row.faction,
       b.character_id === undefined ? row.character_id : b.character_id,
       b.ship_id === undefined ? row.ship_id : b.ship_id,
       b.q ?? row.q, b.r ?? row.r, b.scale ?? row.scale, b.facing ?? row.facing,
       b.hp === undefined ? row.hp : b.hp, b.max_hp === undefined ? row.max_hp : b.max_hp,
       b.conditions ? JSON.stringify(b.conditions) : row.conditions_json,
       b.hidden ?? row.hidden, now, id],
    );
    const updated = getTokenRow(id)!;
    broadcastToken(updated, 'token:updated');
    return c.json(tokenOut(updated), 200);
  });

  app.openapi(deleteRoute, (c) => {
    assertAdmin(c);
    const { id } = c.req.valid('param');
    const row = getTokenRow(id);
    if (!row) throw new HTTPException(404, { message: 'Token not found' });
    swdndDb.run('DELETE FROM token WHERE id = ?', [id]);
    const campaignId = campaignOfScene(row.scene_id);
    if (campaignId) {
      const room = roomForCampaign(campaignId);
      publishToRoom(room, { type: 'token:deleted', room, payload: { id } });
    }
    return c.json({ ok: true }, 200);
  });

  app.openapi(positionRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getTokenRow(id);
    if (!row) throw new HTTPException(404, { message: 'Token not found' });
    assertTokenMoveAccess(c, row);
    const { q, r, facing } = c.req.valid('json');
    const now = new Date().toISOString();
    swdndDb.run(
      'UPDATE token SET q = ?, r = ?, facing = ?, updated_at = ? WHERE id = ?',
      [q ?? row.q, r ?? row.r, facing ?? row.facing, now, id],
    );
    const updated = getTokenRow(id)!;
    broadcastToken(updated, 'token:updated');
    return c.json(tokenOut(updated), 200);
  });

  app.openapi(uploadImageRoute, async (c) => {
    const { id } = c.req.valid('param');
    const row = getTokenRow(id);
    if (!row) throw new HTTPException(404, { message: 'Token not found' });
    assertTokenMoveAccess(c, row);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: 'Missing file' });
    const ext = EXT_BY_MIME[file.type];
    if (!ext) throw new HTTPException(400, { message: 'Only png/jpg/webp images are allowed' });
    if (file.size > MAX_TOKEN_UPLOAD) throw new HTTPException(400, { message: 'Image exceeds 5 MB' });

    mkdirSync(UPLOADS_DIR(), { recursive: true });
    const filename = `token-${id}.${ext}`;
    await Bun.write(join(UPLOADS_DIR(), filename), file);
    for (const otherExt of Object.values(EXT_BY_MIME)) {
      if (otherExt === ext) continue;
      const stalePath = join(UPLOADS_DIR(), `token-${id}.${otherExt}`);
      if (await Bun.file(stalePath).exists()) await unlink(stalePath);
    }
    const now = new Date().toISOString();
    swdndDb.run('UPDATE token SET image_path = ?, updated_at = ? WHERE id = ?', [filename, now, id]);
    const updated = getTokenRow(id)!;
    broadcastToken(updated, 'token:updated');
    return c.json(tokenOut(updated), 200);
  });

  app.openapi(deleteImageRoute, async (c) => {
    const { id } = c.req.valid('param');
    const row = getTokenRow(id);
    if (!row) throw new HTTPException(404, { message: 'Token not found' });
    assertTokenMoveAccess(c, row);
    if (row.image_path && SAFE_FILE.test(row.image_path)) {
      const p = join(UPLOADS_DIR(), row.image_path);
      if (await Bun.file(p).exists()) await unlink(p);
    }
    const now = new Date().toISOString();
    swdndDb.run('UPDATE token SET image_path = NULL, updated_at = ? WHERE id = ?', [now, id]);
    const updated = getTokenRow(id)!;
    broadcastToken(updated, 'token:updated');
    return c.json(tokenOut(updated), 200);
  });
}
