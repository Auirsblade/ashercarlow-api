// apps/backend/src/routes/swdnd/starships.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';

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
}
