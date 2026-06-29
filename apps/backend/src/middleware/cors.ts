import { cors } from 'hono/cors';

const ALLOWED_HOSTS = new Set([
  'ashercarlow.com',
  'www.ashercarlow.com',
  'paulina.ashercarlow.com',
  'starwars.ashercarlow.com',
  'swdnd.ashercarlow.com',
  'api.ashercarlow.com',
]);

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return null;
    try {
      const { hostname } = new URL(origin);
      if (ALLOWED_HOSTS.has(hostname)) return origin;
      if (hostname === 'localhost' || hostname === '127.0.0.1') return origin;
    } catch {
      return null;
    }
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});
