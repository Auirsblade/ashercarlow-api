// apps/backend/src/routes/swdnd/players.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { assertAdmin, resolvePlayerByToken, PlayerRow } from './access';

const Player = z
  .object({
    id: z.string(),
    campaign_id: z.string(),
    name: z.string(),
    access_token: z.string(),
    created_at: z.string(),
  })
  .openapi('SwdndPlayer');

interface CharLite { id: string; name: string; campaign_id: string }

const ErrorBody = z.object({ message: z.string() });
const PostBody = z.object({ name: z.string().min(1) }).openapi('SwdndPostPlayer');
const MeBody = z.object({
  player: Player,
  characters: z.array(z.object({ id: z.string(), name: z.string(), campaign_id: z.string() })),
}).openapi('SwdndPlayerMe');

const postRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/players', tags: ['swdnd'],
  summary: 'Create a player slot in a campaign (DM only); returns a shareable token',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PostBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Player } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const meRoute = createRoute({
  method: 'get', path: '/swdnd/players/me', tags: ['swdnd'],
  summary: 'Resolve a player and their characters from an access token',
  request: { query: z.object({ token: z.string() }) },
  responses: {
    200: { description: 'Player + characters', content: { 'application/json': { schema: MeBody } } },
    404: { description: 'Unknown token', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerPlayerRoutes(app: OpenAPIHono): void {
  app.openapi(postRoute, (c) => {
    assertAdmin(c);
    const { id: campaignId } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });

    const now = new Date().toISOString();
    const playerId = crypto.randomUUID();
    const token = crypto.randomUUID();
    swdndDb.run(
      'INSERT INTO player (id, campaign_id, name, access_token, created_at) VALUES (?, ?, ?, ?, ?)',
      [playerId, campaignId, name, token, now],
    );
    return c.json({ id: playerId, campaign_id: campaignId, name, access_token: token, created_at: now }, 201);
  });

  app.openapi(meRoute, (c) => {
    const { token } = c.req.valid('query');
    const player = resolvePlayerByToken(token);
    if (!player) throw new HTTPException(404, { message: 'Unknown token' });
    const characters = swdndDb
      .query<CharLite, [string]>('SELECT id, name, campaign_id FROM character WHERE player_id = ? ORDER BY created_at ASC')
      .all(player.id);
    return c.json({ player, characters }, 200);
  });
}
