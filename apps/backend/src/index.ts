import { createApiApp } from './lib/openapi';
import { serveStaticSpa } from './lib/static';

const PORT = Number(process.env.PORT ?? 3000);

const RESUME_DIST = process.env.RESUME_DIST ?? 'apps/resume/dist';
const WEDDING_DIST = process.env.WEDDING_DIST ?? 'apps/wedding/dist';
const STARWARS_DIST = process.env.STARWARS_DIST ?? 'apps/starwars/dist';

const api = createApiApp();

function effectiveHost(rawHost: string | null): string {
  if (!rawHost) return 'api.ashercarlow.com';
  const hostname = rawHost.split(':')[0].toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    return 'api.ashercarlow.com';
  }
  return hostname;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const host = effectiveHost(req.headers.get('host'));

    switch (host) {
      case 'ashercarlow.com':
      case 'www.ashercarlow.com':
        return serveStaticSpa(req, RESUME_DIST);
      case 'paulina.ashercarlow.com':
        return serveStaticSpa(req, WEDDING_DIST);
      case 'starwars.ashercarlow.com':
        return serveStaticSpa(req, STARWARS_DIST);
      case 'api.ashercarlow.com':
        return api.fetch(req);
      default:
        return new Response(`Unknown host: ${host}`, { status: 404 });
    }
  },
});

console.log(`ashercarlow backend listening on http://localhost:${server.port}`);
console.log(`  • API + Swagger:  http://localhost:${server.port}/docs (host: api.ashercarlow.com)`);
console.log(`  • Resume:         host=ashercarlow.com → ${RESUME_DIST}`);
console.log(`  • Wedding:        host=paulina.ashercarlow.com → ${WEDDING_DIST}`);
console.log(`  • Starwars:       host=starwars.ashercarlow.com → ${STARWARS_DIST}`);
