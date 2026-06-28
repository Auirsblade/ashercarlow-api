import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { authGate } from './auth';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const Classification = z
  .enum(['essential', 'lore_light', 'filler'])
  .nullable()
  .openapi({ example: 'essential' });

const Episode = z
  .object({
    id: z.number().openapi({ example: 1 }),
    season: z.number().nullable().openapi({ example: 2 }),
    episode: z.number().nullable().openapi({ example: 16 }),
    title: z.string().openapi({ example: 'Cat and Mouse' }),
    arc: z.string().nullable().openapi({ example: 'Christophsis' }),
    classification: Classification,
    watched: z.boolean().openapi({ example: false }),
    characters: z.array(z.string()).openapi({ example: ['anakin', 'obi-wan'] }),
    notes: z.string().nullable().openapi({ example: null }),
    reviewed_at: z.string().nullable().openapi({ example: null }),
    watched_at: z.string().nullable().openapi({ example: null }),
  })
  .openapi('SwtcwEpisode');

const Character = z
  .object({
    id: z.string().openapi({ example: 'anakin' }),
    name: z.string().openapi({ example: 'Anakin' }),
    sort_order: z.number().openapi({ example: 10 }),
    is_seed: z.boolean().openapi({ example: true }),
    episode_count: z.number().openapi({ example: 42 }),
  })
  .openapi('SwtcwCharacter');

const ErrorBody = z.object({ message: z.string() });

const PatchEpisodeBody = z
  .object({
    classification: z.enum(['essential', 'lore_light', 'filler']).nullable().optional(),
    watched: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  })
  .openapi('SwtcwPatchEpisode');

const PutCharactersBody = z
  .object({ character_ids: z.array(z.string()) })
  .openapi('SwtcwPutCharacters');

const PostCharacterBody = z
  .object({ name: z.string().min(1) })
  .openapi('SwtcwPostCharacter');

const ImportFromPitwallBody = z
  .object({
    source_url: z
      .string()
      .url()
      .optional()
      .openapi({ example: 'https://pitwall.ashercarlow.com/api/swtcw' }),
  })
  .openapi('SwtcwImportFromPitwall');

const ImportResult = z
  .object({
    source_url: z.string(),
    episodes_updated: z.number(),
    characters_upserted: z.number(),
    episode_character_links: z.number(),
  })
  .openapi('SwtcwImportResult');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

interface EpisodeRow {
  id: number;
  season: number | null;
  episode: number | null;
  title: string;
  arc: string | null;
  classification: string | null;
  watched: number;
  notes: string | null;
  reviewed_at: string | null;
  watched_at: string | null;
  char_ids: string | null;
}

function shapeEpisode(row: EpisodeRow): z.infer<typeof Episode> {
  return {
    id: row.id,
    season: row.season,
    episode: row.episode,
    title: row.title,
    arc: row.arc,
    classification: row.classification as z.infer<typeof Classification>,
    watched: row.watched === 1,
    characters: row.char_ids ? row.char_ids.split(',') : [],
    notes: row.notes,
    reviewed_at: row.reviewed_at,
    watched_at: row.watched_at,
  };
}

function fetchEpisodeRow(id: number): z.infer<typeof Episode> | null {
  const row = db
    .query<EpisodeRow, [number]>(
      `SELECT e.id, e.season, e.episode, e.title, e.arc, e.classification,
              e.watched, e.notes, e.reviewed_at, e.watched_at,
              GROUP_CONCAT(ec.character_id) AS char_ids
         FROM swtcw_episodes e
         LEFT JOIN swtcw_episode_characters ec ON ec.episode_id = e.id
        WHERE e.id = ?
        GROUP BY e.id`,
    )
    .get(id);
  return row ? shapeEpisode(row) : null;
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const listEpisodesRoute = createRoute({
  method: 'get',
  path: '/swtcw/episodes',
  tags: ['swtcw'],
  summary: 'List all Clone Wars episodes (chronological viewing order)',
  responses: {
    200: {
      description: 'All 134 episodes with current watch/notes/character state',
      content: { 'application/json': { schema: z.array(Episode) } },
    },
  },
});

const listCharactersRoute = createRoute({
  method: 'get',
  path: '/swtcw/characters',
  tags: ['swtcw'],
  summary: 'List all characters',
  responses: {
    200: {
      description: 'Characters with episode counts',
      content: { 'application/json': { schema: z.array(Character) } },
    },
  },
});

const patchEpisodeRoute = createRoute({
  method: 'patch',
  path: '/swtcw/episodes/{id}',
  tags: ['swtcw'],
  summary: 'Update an episode (watched, classification, notes)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/).openapi({ example: '1' }) }),
    body: { content: { 'application/json': { schema: PatchEpisodeBody } } },
  },
  responses: {
    200: {
      description: 'Updated episode',
      content: { 'application/json': { schema: Episode } },
    },
    400: { description: 'Invalid id or empty patch', content: { 'application/json': { schema: ErrorBody } } },
    401: { description: 'Missing or invalid auth token', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Episode not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const putCharactersRoute = createRoute({
  method: 'put',
  path: '/swtcw/episodes/{id}/characters',
  tags: ['swtcw'],
  summary: 'Replace the character tags on an episode',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/).openapi({ example: '1' }) }),
    body: { content: { 'application/json': { schema: PutCharactersBody } } },
  },
  responses: {
    200: { description: 'Updated episode', content: { 'application/json': { schema: Episode } } },
    400: { description: 'Invalid id or unknown character ids', content: { 'application/json': { schema: ErrorBody } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Episode not found', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const postCharacterRoute = createRoute({
  method: 'post',
  path: '/swtcw/characters',
  tags: ['swtcw'],
  summary: 'Create a new character (slug derived from name)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: PostCharacterBody } } } },
  responses: {
    201: { description: 'Created character', content: { 'application/json': { schema: Character } } },
    400: { description: 'Empty slug', content: { 'application/json': { schema: ErrorBody } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    409: { description: 'Character id already exists', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const deleteCharacterRoute = createRoute({
  method: 'delete',
  path: '/swtcw/characters/{id}',
  tags: ['swtcw'],
  summary: 'Delete a character (only if not referenced)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().openapi({ example: 'cad-bane' }) }) },
  responses: {
    204: { description: 'Deleted' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorBody } } },
    409: { description: 'In use — untag first', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const importRoute = createRoute({
  method: 'post',
  path: '/swtcw/admin/import-from-pitwall',
  tags: ['swtcw'],
  summary: 'One-shot import of live SWTCW data from pitwall.ashercarlow.com',
  description:
    'Pulls the current episodes and characters from a pitwall deployment and upserts them into the local database. ' +
    'Idempotent: safe to re-run. Defaults to https://pitwall.ashercarlow.com/api/swtcw.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: ImportFromPitwallBody } },
      required: false,
    },
  },
  responses: {
    200: { description: 'Import summary', content: { 'application/json': { schema: ImportResult } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    502: { description: 'Failed to reach pitwall', content: { 'application/json': { schema: ErrorBody } } },
  },
});

// ---------------------------------------------------------------------------
// Pitwall import
// ---------------------------------------------------------------------------

interface PitwallEpisode {
  id: number;
  season: number | null;
  episode: number | null;
  title: string;
  arc: string | null;
  classification: 'essential' | 'lore_light' | 'filler' | null;
  watched: boolean;
  characters: string[];
  notes: string | null;
  reviewed_at: string | null;
  watched_at: string | null;
}

interface PitwallCharacter {
  id: string;
  name: string;
  sort_order: number;
  is_seed: boolean;
  episode_count: number;
}

async function importFromPitwall(sourceUrl: string): Promise<z.infer<typeof ImportResult>> {
  const base = sourceUrl.replace(/\/$/, '');

  let episodes: PitwallEpisode[];
  let characters: PitwallCharacter[];
  try {
    const [epRes, charRes] = await Promise.all([
      fetch(`${base}/episodes`),
      fetch(`${base}/characters`),
    ]);
    if (!epRes.ok) throw new Error(`episodes HTTP ${epRes.status}`);
    if (!charRes.ok) throw new Error(`characters HTTP ${charRes.status}`);
    episodes = (await epRes.json()) as PitwallEpisode[];
    characters = (await charRes.json()) as PitwallCharacter[];
  } catch (err) {
    throw new HTTPException(502, {
      message: `Failed to fetch from ${base}: ${(err as Error).message}`,
    });
  }

  const upsertChar = db.prepare(
    `INSERT INTO swtcw_characters (id, name, sort_order, is_seed)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, is_seed=excluded.is_seed`,
  );

  const updateEpisode = db.prepare(
    `UPDATE swtcw_episodes
        SET watched = ?, watched_at = ?, classification = ?, reviewed_at = ?, notes = ?
      WHERE id = ?`,
  );

  const clearLinks = db.prepare('DELETE FROM swtcw_episode_characters');
  const insertLink = db.prepare(
    'INSERT INTO swtcw_episode_characters (episode_id, character_id) VALUES (?, ?)',
  );

  let linkCount = 0;
  let updatedEpisodes = 0;

  db.transaction(() => {
    for (const ch of characters) {
      upsertChar.run(ch.id, ch.name, ch.sort_order, ch.is_seed ? 1 : 0);
    }
    clearLinks.run();
    for (const ep of episodes) {
      const r = updateEpisode.run(
        ep.watched ? 1 : 0,
        ep.watched_at,
        ep.classification,
        ep.reviewed_at,
        ep.notes,
        ep.id,
      );
      if (r.changes > 0) updatedEpisodes += 1;
      for (const cid of ep.characters) {
        insertLink.run(ep.id, cid);
        linkCount += 1;
      }
    }
  })();

  return {
    source_url: base,
    episodes_updated: updatedEpisodes,
    characters_upserted: characters.length,
    episode_character_links: linkCount,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSwtcwRoutes(app: OpenAPIHono): void {
  app.use('/swtcw/*', async (c, next) => {
    const blocked = authGate(c);
    if (blocked) return blocked;
    return next();
  });

  app.openapi(listEpisodesRoute, (c) => {
    const rows = db
      .query<EpisodeRow, []>(
        `SELECT e.id, e.season, e.episode, e.title, e.arc, e.classification,
                e.watched, e.notes, e.reviewed_at, e.watched_at,
                GROUP_CONCAT(ec.character_id) AS char_ids
           FROM swtcw_episodes e
           LEFT JOIN swtcw_episode_characters ec ON ec.episode_id = e.id
          GROUP BY e.id
          ORDER BY e.id ASC`,
      )
      .all();
    return c.json(rows.map(shapeEpisode), 200);
  });

  app.openapi(listCharactersRoute, (c) => {
    const rows = db
      .query<
        {
          id: string;
          name: string;
          sort_order: number;
          is_seed: number;
          episode_count: number;
        },
        []
      >(
        `SELECT ch.id, ch.name, ch.sort_order, ch.is_seed,
                COUNT(ec.episode_id) AS episode_count
           FROM swtcw_characters ch
           LEFT JOIN swtcw_episode_characters ec ON ec.character_id = ch.id
          GROUP BY ch.id
          ORDER BY ch.sort_order ASC, ch.name ASC`,
      )
      .all();
    return c.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        sort_order: r.sort_order,
        is_seed: r.is_seed === 1,
        episode_count: r.episode_count,
      })),
      200,
    );
  });

  app.openapi(patchEpisodeRoute, (c) => {
    const id = Number(c.req.valid('param').id);

    const existing = db
      .query<{ id: number }, [number]>('SELECT id FROM swtcw_episodes WHERE id = ?')
      .get(id);
    if (!existing) {
      throw new HTTPException(404, { message: 'Episode not found' });
    }

    const body = c.req.valid('json');
    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: (string | number | null)[] = [];

    if ('classification' in body) {
      sets.push('classification = ?');
      params.push(body.classification ?? null);
      if (body.classification != null) {
        sets.push('reviewed_at = ?');
        params.push(now);
      } else {
        sets.push('reviewed_at = NULL');
      }
    }

    if ('watched' in body) {
      sets.push('watched = ?');
      params.push(body.watched ? 1 : 0);
      if (body.watched) {
        sets.push('watched_at = ?');
        params.push(now);
      } else {
        sets.push('watched_at = NULL');
      }
    }

    if ('notes' in body) {
      sets.push('notes = ?');
      params.push(body.notes ?? null);
    }

    if (sets.length === 0) {
      throw new HTTPException(400, { message: 'No fields to update' });
    }

    params.push(id);
    db.run(`UPDATE swtcw_episodes SET ${sets.join(', ')} WHERE id = ?`, params);

    const updated = fetchEpisodeRow(id);
    if (!updated) throw new HTTPException(404, { message: 'Episode disappeared' });
    return c.json(updated, 200);
  });

  app.openapi(putCharactersRoute, (c) => {
    const id = Number(c.req.valid('param').id);

    const episode = db
      .query<{ id: number }, [number]>('SELECT id FROM swtcw_episodes WHERE id = ?')
      .get(id);
    if (!episode) {
      throw new HTTPException(404, { message: 'Episode not found' });
    }

    const { character_ids } = c.req.valid('json');

    if (character_ids.length > 0) {
      const placeholders = character_ids.map(() => '?').join(',');
      const existing = db
        .query<{ id: string }, string[]>(
          `SELECT id FROM swtcw_characters WHERE id IN (${placeholders})`,
        )
        .all(...character_ids);
      const existingSet = new Set(existing.map((r) => r.id));
      const unknown = character_ids.filter((cid) => !existingSet.has(cid));
      if (unknown.length > 0) {
        throw new HTTPException(400, {
          message: `Unknown character ids: ${unknown.join(', ')}`,
        });
      }
    }

    db.transaction(() => {
      db.run('DELETE FROM swtcw_episode_characters WHERE episode_id = ?', [id]);
      for (const cid of character_ids) {
        db.run(
          'INSERT INTO swtcw_episode_characters (episode_id, character_id) VALUES (?, ?)',
          [id, cid],
        );
      }
    })();

    const updated = fetchEpisodeRow(id);
    if (!updated) throw new HTTPException(404, { message: 'Episode disappeared' });
    return c.json(updated, 200);
  });

  app.openapi(postCharacterRoute, (c) => {
    const { name } = c.req.valid('json');
    const id = slugify(name);
    if (!id) {
      throw new HTTPException(400, { message: 'Name produces an empty slug' });
    }

    const existing = db
      .query<{ id: string }, [string]>('SELECT id FROM swtcw_characters WHERE id = ?')
      .get(id);
    if (existing) {
      throw new HTTPException(409, { message: 'Character id already exists' });
    }

    const maxRow = db
      .query<{ max_order: number | null }, []>(
        'SELECT MAX(sort_order) AS max_order FROM swtcw_characters',
      )
      .get();
    const sortOrder = (maxRow?.max_order ?? 0) + 10;

    db.run(
      'INSERT INTO swtcw_characters (id, name, sort_order, is_seed) VALUES (?, ?, ?, 0)',
      [id, name, sortOrder],
    );

    return c.json(
      {
        id,
        name,
        sort_order: sortOrder,
        is_seed: false,
        episode_count: 0,
      },
      201,
    );
  });

  app.openapi(deleteCharacterRoute, (c) => {
    const { id } = c.req.valid('param');

    const character = db
      .query<{ id: string }, [string]>('SELECT id FROM swtcw_characters WHERE id = ?')
      .get(id);
    if (!character) {
      throw new HTTPException(404, { message: 'Character not found' });
    }

    const usage = db
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM swtcw_episode_characters WHERE character_id = ?',
      )
      .get(id)!;

    if (usage.count > 0) {
      throw new HTTPException(409, {
        message: `Character is referenced by ${usage.count} episode(s); untag it first`,
      });
    }

    db.run('DELETE FROM swtcw_characters WHERE id = ?', [id]);
    return new Response(null, { status: 204 });
  });

  app.openapi(importRoute, async (c) => {
    const body = c.req.valid('json') ?? {};
    const sourceUrl = body.source_url ?? 'https://pitwall.ashercarlow.com/api/swtcw';
    const result = await importFromPitwall(sourceUrl);
    return c.json(result, 200);
  });
}
