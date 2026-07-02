// apps/backend/src/routes/swdnd/access.ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { swdndDb } from '../../db/swdnd';
import { isCookieAuthed } from '../auth';

export interface PlayerRow {
  id: string;
  campaign_id: string;
  name: string;
  access_token: string;
  created_at: string;
}

/** Resolve a player slot by its unguessable access token. */
export function resolvePlayerByToken(token: string | undefined): PlayerRow | null {
  if (!token) return null;
  return swdndDb
    .query<PlayerRow, [string]>('SELECT * FROM player WHERE access_token = ?')
    .get(token) ?? null;
}

/** The player token from header or query string, if any. */
export function playerTokenFrom(c: Context): string | undefined {
  return c.req.header('X-Player-Token') ?? new URL(c.req.url).searchParams.get('token') ?? undefined;
}

function isAdmin(c: Context): boolean {
  const expected = process.env.ASHERCARLOW_AUTH_TOKEN;
  if (!expected) return false;
  const header = c.req.header('Authorization')?.replace('Bearer ', '');
  return header === expected || isCookieAuthed(c);
}

/**
 * Throw 403 unless the requester may write this character:
 * dev mode (no admin token), the admin, or the owning player's token.
 */
export function assertCharacterWriteAccess(c: Context, character: { player_id: string | null }): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return; // dev mode
  if (isAdmin(c)) return;
  const player = resolvePlayerByToken(playerTokenFrom(c));
  if (player && character.player_id && player.id === character.player_id) return;
  throw new HTTPException(403, { message: 'Not allowed to modify this character' });
}

/** Throw 403 unless the requester is the admin (dev mode passes). */
export function assertAdmin(c: Context): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return;
  if (!isAdmin(c)) throw new HTTPException(403, { message: 'Admin only' });
}
