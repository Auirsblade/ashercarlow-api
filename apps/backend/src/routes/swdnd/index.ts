import type { OpenAPIHono } from '@hono/zod-openapi';
import { authGate } from '../auth';
import { registerContentRoutes } from './content';
import { registerCampaignRoutes } from './campaigns';
import { registerCharacterRoutes } from './characters';
import { registerPlayerRoutes } from './players';

export function registerSwdndRoutes(app: OpenAPIHono): void {
  app.use('/swdnd/*', async (c, next) => {
    const blocked = authGate(c);
    if (blocked) return blocked;
    return next();
  });

  registerContentRoutes(app);
  registerCampaignRoutes(app);
  registerCharacterRoutes(app);
  registerPlayerRoutes(app);
}
