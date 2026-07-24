// apps/backend/src/routes/swdnd/index.ts
import type { OpenAPIHono } from '@hono/zod-openapi';
import { authGate } from '../auth';
import { registerContentRoutes } from './content';
import { registerCampaignRoutes } from './campaigns';
import { registerCharacterRoutes } from './characters';
import { registerEncounterRoutes } from './encounters';
import { registerPlayerRoutes } from './players';
import { registerRollRoutes } from './rolls';
import { registerSceneRoutes } from './scenes';
import { registerTemplateRoutes } from './templates';
import { registerTokenRoutes } from './tokens';

/** Paths whose mutations run their own (player-or-admin) access check, so the
 * blanket admin-only gate must not pre-empt them.
 *
 * NOTE: this is intentionally a coarse prefix/suffix match for the current
 * route set. It fails CLOSED on edge cases (trailing slash, query string) but
 * a NEW route that happens to start with `/swdnd/characters` or end in
 * `/characters`/`/players` would be silently exempted from the admin gate.
 * When adding swdnd routes, confirm any newly-exempted path enforces its own
 * access check (assertAdmin / assertCharacterWriteAccess), or tighten this. */
function selfGated(path: string): boolean {
  return (
    path.startsWith('/swdnd/characters') ||
    path.startsWith('/swdnd/tokens') || // position PATCH does its own player check; token PATCH/DELETE assertAdmin in-handler
    path.startsWith('/swdnd/templates') || // member-gated delete in-handler
    path.endsWith('/characters') ||
    path.endsWith('/players') ||
    path.endsWith('/templates') || // member-gated create; clear-all asserts admin in-handler
    path.endsWith('/rolls') // member-gated create in-handler; GET filters hidden in-handler
  );
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
  registerEncounterRoutes(app);
  registerPlayerRoutes(app);
  registerRollRoutes(app);
  registerSceneRoutes(app);
  registerTemplateRoutes(app);
  registerTokenRoutes(app);
}
