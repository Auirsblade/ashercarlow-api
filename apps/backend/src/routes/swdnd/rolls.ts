// apps/backend/src/routes/swdnd/rolls.ts — campaign roll log (append-only).
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { publishToRoom, roomForCampaign } from '../../lib/swdnd-realtime';
import { assertCampaignMember, isAdminRequest, playerTokenFrom, resolvePlayerByToken } from './access';

const RollDie = z.object({ sides: z.number().int().min(2), value: z.number().int().min(1) });
const Roll = z.object({
  id: z.string(), campaign_id: z.string(), roller: z.string(), label: z.string().nullable(),
  formula: z.string(), rolls_json: z.array(RollDie), total: z.number(),
  hidden: z.number(), created_at: z.string(),
}).openapi('SwdndRoll');

const PostBody = z.object({
  roller: z.string().min(1).max(60).optional(),
  label: z.string().max(120).optional(),
  formula: z.string().min(1).max(120),
  rolls: z.array(RollDie).max(200),
  total: z.number().int(),
  hidden: z.boolean().optional(),
}).openapi('SwdndPostRoll');

const ErrorBody = z.object({ message: z.string() });

interface RollRow {
  id: string; campaign_id: string; roller: string; label: string | null;
  formula: string; rolls_json: string; total: number; hidden: number; created_at: string;
}
const rollOut = (r: RollRow) => ({ ...r, rolls_json: JSON.parse(r.rolls_json || '[]') });
const campaignExists = (id: string): boolean =>
  !!swdndDb.query('SELECT id FROM campaign WHERE id = ?').get(id);

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/rolls', tags: ['swdnd'],
  summary: 'List recent rolls (secret DM rolls stripped for non-admins)',
  request: { params: z.object({ id: z.string() }), query: z.object({ limit: z.string().optional() }) },
  responses: {
    200: { description: 'Rolls, newest first', content: { 'application/json': { schema: z.array(Roll) } } },
    404: { description: 'No campaign', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const createRollRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/rolls', tags: ['swdnd'],
  summary: 'Record a roll (any campaign member; hidden is DM-only)',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Recorded', content: { 'application/json': { schema: Roll } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'No campaign', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerRollRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!campaignExists(id)) throw new HTTPException(404, { message: 'Campaign not found' });
    const limit = Math.min(Math.max(Number(c.req.valid('query').limit) || 50, 1), 100);
    // GETs bypass the blanket gate, so the hidden filter is enforced here.
    const rows = isAdminRequest(c)
      ? swdndDb.query<RollRow, [string, number]>(
          'SELECT * FROM roll WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(id, limit)
      : swdndDb.query<RollRow, [string, number]>(
          'SELECT * FROM roll WHERE campaign_id = ? AND hidden = 0 ORDER BY created_at DESC, rowid DESC LIMIT ?').all(id, limit);
    return c.json(rows.map(rollOut), 200);
  });

  app.openapi(createRollRoute, (c) => {
    const { id } = c.req.valid('param');
    if (!campaignExists(id)) throw new HTTPException(404, { message: 'Campaign not found' });
    assertCampaignMember(c, id);
    const b = c.req.valid('json');
    const admin = isAdminRequest(c);
    if (b.hidden && !admin) throw new HTTPException(403, { message: 'Only the DM can roll in secret' });
    const roller = b.roller ?? resolvePlayerByToken(playerTokenFrom(c))?.name ?? 'DM';
    const now = new Date().toISOString();
    const rid = crypto.randomUUID();
    swdndDb.run(
      `INSERT INTO roll (id, campaign_id, roller, label, formula, rolls_json, total, hidden, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rid, id, roller, b.label ?? null, b.formula, JSON.stringify(b.rolls), b.total, b.hidden ? 1 : 0, now],
    );
    const row = swdndDb.query<RollRow, [string]>('SELECT * FROM roll WHERE id = ?').get(rid)!;
    if (!row.hidden) {
      const room = roomForCampaign(id);
      publishToRoom(room, { type: 'roll:created', room, payload: rollOut(row) });
    }
    return c.json(rollOut(row), 201);
  });
}
