// apps/swdnd/src/lib/canEdit.ts
export function resolveCanEdit(opts: { admin: boolean; token: string | null | undefined }): boolean {
  return opts.admin || !!opts.token;
}

/**
 * Client-side mirror of the backend's assertShipWriteAccess: the admin, or a
 * player (identified by their share token) owning ANY character on this ship's
 * crew. Unlike resolveCanEdit for characters — where the loose `admin || token`
 * answer is safe because the server owns the ownership check — a ship's roster
 * is already in hand from the GET, so the client can be precise and avoid
 * showing an editable builder that would 403 on save.
 *
 * The server remains the authority; this only decides what the UI offers.
 */
export function resolveShipCanEdit(opts: {
  admin: boolean;
  token: string | null | undefined;
  playerCharacterIds: string[];
  crew: Array<{ character_id: string }>;
}): boolean {
  if (opts.admin) return true;
  if (!opts.token) return false;
  const own = new Set(opts.playerCharacterIds);
  return opts.crew.some((m) => own.has(m.character_id));
}
