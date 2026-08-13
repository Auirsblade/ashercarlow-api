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

/**
 * Non-throwing admin check for read-side filtering (e.g. hidden rolls).
 * Dev mode (env token unset) counts as admin — dev sees everything.
 */
export function isAdminRequest(c: Context): boolean {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return true;
  return isAdmin(c);
}

/**
 * Throw 403 unless the requester may move this token: dev mode, the admin, or
 * the player owning the token's linked character.
 */
export function assertTokenMoveAccess(c: Context, token: { character_id: string | null }): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return; // dev mode
  if (isAdmin(c)) return;
  if (token.character_id) {
    const player = resolvePlayerByToken(playerTokenFrom(c));
    if (player) {
      const owner = swdndDb
        .query<{ player_id: string | null }, [string]>('SELECT player_id FROM character WHERE id = ?')
        .get(token.character_id);
      if (owner?.player_id && owner.player_id === player.id) return;
    }
  }
  throw new HTTPException(403, { message: 'Not allowed to move this token' });
}

/**
 * Any authed member of the campaign: admin (bearer/cookie) or a player token
 * belonging to that campaign. Dev mode (env token unset) passes everything.
 */
export function assertCampaignMember(c: Context, campaignId: string): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return;
  if (isAdmin(c)) return;
  const player = resolvePlayerByToken(playerTokenFrom(c));
  if (player && player.campaign_id === campaignId) return;
  throw new HTTPException(403, { message: 'Not a member of this campaign' });
}

/**
 * Does this player own ANY character on this ship's crew? One indexed join
 * (idx_starship_crew_character + character PK). Non-throwing so the creation
 * bootstrap can distinguish "no crew given" (400) from "not yours" (403).
 */
export function playerCrewsShip(playerId: string, shipId: string): boolean {
  const row = swdndDb
    .query<{ one: number }, [string, string]>(
      `SELECT 1 AS one FROM starship_crew sc
         JOIN character ch ON ch.id = sc.character_id
        WHERE sc.ship_id = ? AND ch.player_id = ?
        LIMIT 1`,
    )
    .get(shipId, playerId);
  return !!row;
}

/**
 * Throw 403 unless the requester may write this ship: dev mode (no admin token
 * configured), the admin, or a player owning any character on the ship's crew.
 *
 * Crew edits EVERYTHING -- build, play state, and the roster alike. One write
 * rule; the table trusts itself. Accepted consequence: a crew member can remove
 * the last crew entry and strand the ship for players (the admin can recover it).
 */
export function assertShipWriteAccess(c: Context, shipId: string): void {
  if (!process.env.ASHERCARLOW_AUTH_TOKEN) return; // dev mode
  if (isAdmin(c)) return;
  const player = resolvePlayerByToken(playerTokenFrom(c));
  if (player && playerCrewsShip(player.id, shipId)) return;
  throw new HTTPException(403, { message: 'Not allowed to modify this starship' });
}

/**
 * WS upgrade auth on a RAW Request (no Hono context): dev mode admits anyone;
 * otherwise require the admin bearer/cookie or a player token belonging to
 * this campaign. Closes the foundation's unauthenticated-upgrade deferral.
 */
export function canJoinCampaignRoom(req: Request, campaignId: string): boolean {
  const expected = process.env.ASHERCARLOW_AUTH_TOKEN;
  if (!expected) return true; // dev mode

  const bearer = req.headers.get('authorization')?.replace('Bearer ', '');
  if (bearer === expected) return true;
  const cookies = req.headers.get('cookie') ?? '';
  const match = cookies.match(/(?:^|;\s*)ashercarlow_auth=([^;]+)/);
  if (match && decodeURIComponent(match[1]) === expected) return true;

  const token = new URL(req.url).searchParams.get('token') ?? undefined;
  const player = resolvePlayerByToken(token);
  return !!player && player.campaign_id === campaignId;
}
