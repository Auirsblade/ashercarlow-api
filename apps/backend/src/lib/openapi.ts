import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { HTTPException } from 'hono/http-exception';
import { corsMiddleware } from '../middleware/cors';
import { registerAuthRoutes } from '../routes/auth';
import { registerMusicRoutes } from '../routes/music';
import { registerSwtcwRoutes } from '../routes/swtcw';
import { registerSwdndRoutes } from '../routes/swdnd';

export function createApiApp(): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        const first = result.error.issues[0];
        const message = first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request';
        return c.json({ message }, 400);
      }
    },
  });

  app.use('*', corsMiddleware);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const status = err.status;
      return c.json({ message: err.message }, status);
    }
    console.error('[api] unhandled error:', err);
    return c.json({ message: 'Internal server error' }, 500);
  });

  app.get('/', (c) =>
    c.json({ ok: true, service: 'ashercarlow-api', docs: '/docs' }),
  );

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'ASHERCARLOW_AUTH_TOKEN as a Bearer token.',
  });

  registerAuthRoutes(app);
  registerMusicRoutes(app);
  registerSwtcwRoutes(app);
  registerSwdndRoutes(app);

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'ashercarlow API',
      description:
        'Backend endpoints for ashercarlow.com properties (music metadata, SWTCW Clone Wars tracker, swdnd Star Wars D&D).',
    },
  });

  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  return app;
}
