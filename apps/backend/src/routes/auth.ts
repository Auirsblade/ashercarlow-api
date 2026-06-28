import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';

export const AUTH_COOKIE = 'ashercarlow_auth';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function rawHost(c: Context): string {
  return (c.req.header('host') ?? '').split(':')[0].toLowerCase();
}

function cookieDomain(c: Context): string | undefined {
  const h = rawHost(c);
  if (h === 'ashercarlow.com' || h.endsWith('.ashercarlow.com')) {
    return '.ashercarlow.com';
  }
  return undefined; // localhost / dev: default to current host
}

function cookieSecure(c: Context): boolean {
  const h = rawHost(c);
  return h !== 'localhost' && h !== '127.0.0.1';
}

/** Read the auth cookie and check it against the configured admin token. */
export function isCookieAuthed(c: Context): boolean {
  const expected = process.env.ASHERCARLOW_AUTH_TOKEN;
  if (!expected) return false;
  const cookie = getCookie(c, AUTH_COOKIE);
  return !!cookie && cookie === expected;
}

/** Shared mutation gate: GET requests pass; non-GET requires the admin Bearer
 * token or a valid session cookie. Allows everything when ASHERCARLOW_AUTH_TOKEN
 * is unset (dev mode). */
export function authGate(c: Context): Response | null {
  if (c.req.method === 'GET') return null;
  const expected = process.env.ASHERCARLOW_AUTH_TOKEN;
  if (!expected) return null;
  const header = c.req.header('Authorization');
  const headerToken = header?.replace('Bearer ', '');
  if (headerToken === expected) return null;
  if (isCookieAuthed(c)) return null;
  return Response.json({ message: 'Unauthorized' }, { status: 401 });
}

const ErrorBody = z.object({ message: z.string() });
const Ok = z.object({ ok: z.boolean() });
const Me = z.object({ authed: z.boolean() });

const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Exchange the admin token for a .ashercarlow.com session cookie',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ token: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Cookie set', content: { 'application/json': { schema: Ok } } },
    401: { description: 'Invalid token', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  summary: 'Clear the session cookie',
  responses: {
    200: { description: 'Cookie cleared', content: { 'application/json': { schema: Ok } } },
  },
});

const meRoute = createRoute({
  method: 'get',
  path: '/auth/me',
  tags: ['auth'],
  summary: 'Whether the current request carries a valid session cookie',
  responses: {
    200: { description: 'Auth state', content: { 'application/json': { schema: Me } } },
  },
});

export function registerAuthRoutes(app: OpenAPIHono): void {
  app.openapi(loginRoute, async (c) => {
    const { token } = c.req.valid('json');
    const expected = process.env.ASHERCARLOW_AUTH_TOKEN;
    if (!expected || token !== expected) {
      throw new HTTPException(401, { message: 'Invalid token' });
    }
    setCookie(c, AUTH_COOKIE, token, {
      domain: cookieDomain(c),
      path: '/',
      secure: cookieSecure(c),
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: MAX_AGE,
    });
    return c.json({ ok: true }, 200);
  });

  app.openapi(logoutRoute, (c) => {
    deleteCookie(c, AUTH_COOKIE, {
      domain: cookieDomain(c),
      path: '/',
    });
    return c.json({ ok: true }, 200);
  });

  app.openapi(meRoute, (c) => c.json({ authed: isCookieAuthed(c) }, 200));
}
