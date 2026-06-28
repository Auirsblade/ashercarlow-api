import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { REFERENCE_TABLES } from '../../db/swdnd/reference';

const VALID_CATEGORIES = new Set(REFERENCE_TABLES.map((t) => t.table));
const ErrorBody = z.object({ message: z.string() });

const listContentRoute = createRoute({
  method: 'get',
  path: '/swdnd/content/{category}',
  tags: ['swdnd'],
  summary: 'List sw5e reference content for a category (e.g. species, classes, powers)',
  request: {
    params: z.object({ category: z.string().openapi({ example: 'species' }) }),
  },
  responses: {
    200: {
      description: 'Reference rows for the category',
      content: { 'application/json': { schema: z.array(z.record(z.any())) } },
    },
    404: {
      description: 'Unknown category',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

export function registerContentRoutes(app: OpenAPIHono): void {
  app.openapi(listContentRoute, (c) => {
    const { category } = c.req.valid('param');
    if (!VALID_CATEGORIES.has(category)) {
      throw new HTTPException(404, { message: `Unknown category: ${category}` });
    }
    const rows = swdndDb.query(`SELECT * FROM ${category} ORDER BY name ASC`).all();
    return c.json(rows, 200);
  });
}
