// apps/backend/src/routes/swdnd/starships.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { assertAdmin, playerTokenFrom, resolvePlayerByToken } from './access';

export const SHIP_ROLES = ['coordinator', 'gunner', 'mechanic', 'operator', 'pilot', 'technician'] as const;
const RoleEnum = z.enum(SHIP_ROLES);

const PostBody = z
  .object({
    name: z.string().min(1),
    crew: z.object({ characterId: z.string(), role: RoleEnum }).optional(),
  })
  .openapi('SwdndPostStarship');

// Mirrors the frontend engine's emptyShipBuild() (apps/swdnd/src/lib/shipRules/types.ts).
// They can't share code across the backend/frontend boundary -- keep the two in
// sync when the build schema (schemaVersion) changes. Same convention as
// emptyBuildJson in characters.ts:42.
function emptyShipBuildJson(name: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    identity: { name, sizeId: '', tier: 0 },
    abilities: { base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, increases: [] },
    equipment: [],
    modifications: [],
    play: {
      hull: 0, shields: 0, hullDiceSpent: 0, shieldDiceSpent: 0,
      ammoSpent: {}, conditions: [], systemDamage: 0, notes: '',
    },
    overrides: {},
    houseRuled: [],
  });
}

const CrewMember = z
  .object({ character_id: z.string(), character_name: z.string(), role: z.string() })
  .openapi('SwdndStarshipCrewMember');

const Starship = z
  .object({
    id: z.string(),
    campaign_id: z.string(),
    name: z.string(),
    data_json: z.record(z.any()),
    created_at: z.string(),
    updated_at: z.string(),
    crew: z.array(CrewMember),
  })
  .openapi('SwdndStarship');

export interface StarshipRow {
  id: string;
  campaign_id: string;
  name: string;
  data_json: string;
  created_at: string;
  updated_at: string;
}
export interface CrewRow {
  character_id: string;
  character_name: string;
  role: string;
}

const ErrorBody = z.object({ message: z.string() });

function crewFor(shipId: string): CrewRow[] {
  return swdndDb
    .query<CrewRow, [string]>(
      `SELECT sc.character_id AS character_id, sc.role AS role, ch.name AS character_name
         FROM starship_crew sc
         JOIN character ch ON ch.id = sc.character_id
        WHERE sc.ship_id = ?
        ORDER BY sc.role ASC, ch.name ASC`,
    )
    .all(shipId);
}

function toApi(row: StarshipRow) {
  return {
    ...row,
    data_json: JSON.parse(row.data_json) as Record<string, unknown>,
    crew: crewFor(row.id),
  };
}

function getRow(id: string): StarshipRow | null {
  return swdndDb.query<StarshipRow, [string]>('SELECT * FROM starship WHERE id = ?').get(id) ?? null;
}

const listRoute = createRoute({
  method: 'get', path: '/swdnd/campaigns/{id}/starships', tags: ['swdnd'],
  summary: 'List starships in a campaign',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Starships', content: { 'application/json': { schema: z.array(Starship) } } } },
});

const getRoute = createRoute({
  method: 'get', path: '/swdnd/starships/{id}', tags: ['swdnd'],
  summary: 'Get one starship with its crew roster',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Starship', content: { 'application/json': { schema: Starship } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const postRoute = createRoute({
  method: 'post', path: '/swdnd/campaigns/{id}/starships', tags: ['swdnd'],
  summary: 'Create a starship (admin, or a player supplying an initial crew of their own character)',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: PostBody } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: Starship } } },
    400: { description: 'Bad crew bootstrap', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Campaign not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerStarshipRoutes(app: OpenAPIHono): void {
  app.openapi(listRoute, (c) => {
    const { id } = c.req.valid('param');
    const rows = swdndDb
      .query<StarshipRow, [string]>('SELECT * FROM starship WHERE campaign_id = ? ORDER BY created_at ASC')
      .all(id);
    return c.json(rows.map(toApi), 200);
  });

  app.openapi(getRoute, (c) => {
    const { id } = c.req.valid('param');
    const row = getRow(id);
    if (!row) throw new HTTPException(404, { message: 'Starship not found' });
    return c.json(toApi(row), 200);
  });

  app.openapi(postRoute, (c) => {
    const { id: campaignId } = c.req.valid('param');
    const { name, crew } = c.req.valid('json');

    const campaign = swdndDb.query<{ id: string }, [string]>('SELECT id FROM campaign WHERE id = ?').get(campaignId);
    if (!campaign) throw new HTTPException(404, { message: 'Campaign not found' });

    const player = resolvePlayerByToken(playerTokenFrom(c));
    const isPlayerCreate = !!process.env.ASHERCARLOW_AUTH_TOKEN && !!player && player.campaign_id === campaignId;

    if (process.env.ASHERCARLOW_AUTH_TOKEN && !isPlayerCreate) assertAdmin(c);

    if (isPlayerCreate && !crew) {
      // Without an initial crew a player could not edit the ship they just made.
      throw new HTTPException(400, { message: 'A player-created starship needs an initial crew assignment' });
    }

    let character: { id: string; campaign_id: string; player_id: string | null } | null = null;
    if (crew) {
      character = swdndDb
        .query<{ id: string; campaign_id: string; player_id: string | null }, [string]>(
          'SELECT id, campaign_id, player_id FROM character WHERE id = ?',
        )
        .get(crew.characterId) ?? null;
      if (!character || character.campaign_id !== campaignId) {
        throw new HTTPException(400, { message: 'Crew character not found in this campaign' });
      }
      if (isPlayerCreate && character.player_id !== player!.id) {
        throw new HTTPException(403, { message: 'Initial crew must be a character you own' });
      }
    }

    const now = new Date().toISOString();
    const shipId = crypto.randomUUID();
    swdndDb.transaction(() => {
      swdndDb.run(
        'INSERT INTO starship (id, campaign_id, name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [shipId, campaignId, name, emptyShipBuildJson(name), now, now],
      );
      if (crew) {
        swdndDb.run('INSERT INTO starship_crew (ship_id, character_id, role) VALUES (?, ?, ?)',
          [shipId, crew.characterId, crew.role]);
      }
    })();

    return c.json(toApi(getRow(shipId)!), 201);
  });
}
