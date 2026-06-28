import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { isCookieAuthed } from '../auth';
import { registerContentRoutes } from './content';
import { registerCampaignRoutes } from './campaigns';

// Mirror swtcw: GETs are open; mutations require the admin token or cookie.
// In dev (no ASHERCARLOW_AUTH_TOKEN) everything passes.
function authGate(c: Context): Response | null {
  if (c.req.method === 'GET') return null;
  const expected = process.env.ASHERCARLOW_AUTH_TOKEN;
  if (!expected) return null;
  const header = c.req.header('Authorization');
  if (header?.replace('Bearer ', '') === expected) return null;
  if (isCookieAuthed(c)) return null;
  return Response.json({ message: 'Unauthorized' }, { status: 401 });
}

export function registerSwdndRoutes(app: OpenAPIHono): void {
  app.use('/swdnd/*', async (c, next) => {
    const blocked = authGate(c);
    if (blocked) return blocked;
    return next();
  });

  registerContentRoutes(app);
  registerCampaignRoutes(app);
}
