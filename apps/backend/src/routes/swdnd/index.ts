// apps/backend/src/routes/swdnd/index.ts
import type { OpenAPIHono } from '@hono/zod-openapi';
import { authGate } from '../auth';
import { registerContentRoutes } from './content';
import { registerCampaignRoutes } from './campaigns';
import { registerCharacterRoutes } from './characters';
import { registerPlayerRoutes } from './players';

/** Paths whose mutations run their own (player-or-admin) access check, so the
 * blanket admin-only gate must not pre-empt them. */
function selfGated(path: string): boolean {
  return path.startsWith('/swdnd/characters') || path.endsWith('/characters') || path.endsWith('/players');
}

export function registerSwdndRoutes(app: OpenAPIHono): void {
  app.use('/swdnd/*', async (c, next) => {
    if (!selfGated(new URL(c.req.url).pathname)) {
      const blocked = authGate(c);
      if (blocked) return blocked;
    }
    return next();
  });

  registerContentRoutes(app);
  registerCampaignRoutes(app);
  registerCharacterRoutes(app);
  registerPlayerRoutes(app);
}
