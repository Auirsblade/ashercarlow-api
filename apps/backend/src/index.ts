import { createApiApp } from './lib/openapi';
import { serveStaticSpa } from './lib/static';
import { LOGIN_HTML } from './lib/login-page';
import { swdndWebsocket, setRealtimeServer, roomForCampaign, type WsData } from './lib/swdnd-realtime';

const PORT = Number(process.env.PORT ?? 3000);

const RESUME_DIST = process.env.RESUME_DIST ?? 'apps/resume/dist';
const WEDDING_DIST = process.env.WEDDING_DIST ?? 'apps/wedding/dist';
const STARWARS_DIST = process.env.STARWARS_DIST ?? 'apps/starwars/dist';
const SWDND_DIST = process.env.SWDND_DIST ?? 'apps/swdnd/dist';

const FRONTEND_HOSTS = new Set([
  'ashercarlow.com',
  'www.ashercarlow.com',
  'paulina.ashercarlow.com',
  'starwars.ashercarlow.com',
  'swdnd.ashercarlow.com',
]);

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
  async fetch(req, server) {
    const host = effectiveHost(req.headers.get('host'));
    const pathname = new URL(req.url).pathname;

    // swdnd realtime upgrade (api host). room = campaign.
    // SECURITY NOTE: this upgrade is intentionally UNAUTHENTICATED in the
    // foundation. REST + SQLite remain the source of truth, so this only exposes
    // read/relay of live campaign events. Before any feature broadcasts private
    // player/character data over WS, gate this on the player access_token (or an
    // Origin/cookie check). See the Tabletop & Map feature spec.
    if (host === 'api.ashercarlow.com' && pathname === '/swdnd/ws') {
      const campaign = new URL(req.url).searchParams.get('campaign');
      if (!campaign) return new Response('Missing campaign', { status: 400 });
      const upgraded = server.upgrade<WsData>(req, {
        data: { room: roomForCampaign(campaign) },
      });
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 426 });
    }

    // Standalone login page — served on every frontend host so any subdomain can be the
    // landing point. The form POSTs to api.ashercarlow.com/auth/login and the cookie is
    // scoped to .ashercarlow.com.
    if (pathname === '/login' && FRONTEND_HOSTS.has(host)) {
      return new Response(LOGIN_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    switch (host) {
      case 'ashercarlow.com':
      case 'www.ashercarlow.com':
        return serveStaticSpa(req, RESUME_DIST);
      case 'paulina.ashercarlow.com':
        return serveStaticSpa(req, WEDDING_DIST);
      case 'starwars.ashercarlow.com':
        return serveStaticSpa(req, STARWARS_DIST);
      case 'swdnd.ashercarlow.com':
        return serveStaticSpa(req, SWDND_DIST);
      case 'api.ashercarlow.com':
        return api.fetch(req);
      default:
        return new Response(`Unknown host: ${host}`, { status: 404 });
    }
  },
  websocket: swdndWebsocket,
});

setRealtimeServer(server);

console.log(`ashercarlow backend listening on http://localhost:${server.port}`);
console.log(`  • API + Swagger:  http://localhost:${server.port}/docs (host: api.ashercarlow.com)`);
console.log(`  • Resume:         host=ashercarlow.com → ${RESUME_DIST}`);
console.log(`  • Wedding:        host=paulina.ashercarlow.com → ${WEDDING_DIST}`);
console.log(`  • Starwars:       host=starwars.ashercarlow.com → ${STARWARS_DIST}`);
console.log(`  • Swdnd:          host=swdnd.ashercarlow.com → ${SWDND_DIST}`);
