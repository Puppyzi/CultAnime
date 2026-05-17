import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getDb } from '../../../../lib/db';
import { searchAnilist, getAnilistAnime, formatAnilistData } from '../../../../lib/anilist';

const JELLYFIN_URL = () => process.env.JELLYFIN_URL?.replace(/\/+$/, '');
const JELLYFIN_API_KEY = () => process.env.JELLYFIN_API_KEY;

/**
 * Helper: Make an authenticated request to the Jellyfin API.
 */
async function jellyfinFetch(endpoint) {
  const baseUrl = JELLYFIN_URL();
  const apiKey = JELLYFIN_API_KEY();
  if (!baseUrl || !apiKey || baseUrl.includes('your-truenas-ip') || apiKey.includes('your-jellyfin')) {
    throw new Error(
      'Jellyfin is not configured. Update JELLYFIN_URL and JELLYFIN_API_KEY in your .env.local file with your actual Jellyfin server details, then restart the dev server.'
    );
  }
  const sep = endpoint.includes('?') ? '&' : '?';
  let res;
  try {
    res = await fetch(`${baseUrl}${endpoint}${sep}api_key=${apiKey}`);
  } catch (networkErr) {
    throw new Error(`Cannot reach Jellyfin at ${baseUrl}. Make sure the server is running and accessible.`);
  }
  if (!res.ok) throw new Error(`Jellyfin API error: ${res.status} — check your API key and server URL.`);
  return res.json();
}

/**
 * GET /api/admin/sync
 *
 * Preview what Jellyfin has vs what CultAnime has.
 * Returns a list of Jellyfin series with their sync status.
 */
export async function GET() {
  try {
    const db = getDb();

    // Get all TV series from Jellyfin
    const data = await jellyfinFetch(
      '/Items?recursive=true&IncludeItemTypes=Series&fields=Path,ProviderIds'
    );

    const jellyfinSeries = data.Items || [];

    // Get all existing anime from our database
    const existingAnime = db.prepare('SELECT * FROM anime').all();
    const existingByTitle = new Map();
    existingAnime.forEach(a => {
      existingByTitle.set(a.title?.toLowerCase(), a);
      if (a.title_romaji) existingByTitle.set(a.title_romaji.toLowerCase(), a);
      if (a.title_english) existingByTitle.set(a.title_english.toLowerCase(), a);
    });

    // Build the preview list
    const preview = jellyfinSeries.map(series => {
      const name = series.Name || '';
      const existing = existingByTitle.get(name.toLowerCase());

      return {
        jellyfin_id: series.Id,
        name: series.Name,
        path: series.Path,
        provider_ids: series.ProviderIds || {},
        already_exists: !!existing,
        existing_id: existing?.id || null,
      };
    });

    return NextResponse.json({
      total: preview.length,
      new_count: preview.filter(p => !p.already_exists).length,
      existing_count: preview.filter(p => p.already_exists).length,
      series: preview,
    });
  } catch (error) {
    console.error('Sync preview error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/sync
 *
 * Sync one or more Jellyfin series into CultAnime.
 * For each series:
 *   1. Search AniList by the series name to get rich metadata
 *   2. Create the anime entry in our database
 *   3. Fetch all episodes from Jellyfin for that series
 *   4. Create episode entries with file paths and jellyfin_item_ids
 *
 * Body: { jellyfin_ids: ["id1", "id2", ...] }
 *   or: { sync_all: true }
 */
export async function POST(request) {
  try {
    const db = getDb();
    const body = await request.json();
    const { jellyfin_ids, sync_all } = body;

    // Determine which series to sync
    let seriesToSync = [];
    if (sync_all) {
      const data = await jellyfinFetch(
        '/Items?recursive=true&IncludeItemTypes=Series&fields=Path,ProviderIds'
      );
      seriesToSync = data.Items || [];
    } else if (jellyfin_ids?.length > 0) {
      for (const id of jellyfin_ids) {
        const item = await jellyfinFetch(`/Items/${id}?fields=Path,ProviderIds`);
        if (item) seriesToSync.push(item);
      }
    } else {
      return NextResponse.json({ error: 'Provide jellyfin_ids or sync_all' }, { status: 400 });
    }

    const results = [];

    for (const series of seriesToSync) {
      const seriesResult = {
        jellyfin_id: series.Id,
        name: series.Name,
        status: 'pending',
        anime_id: null,
        episodes_added: 0,
        error: null,
      };

      try {
        // --- Step 1: Check if this anime already exists ---
        const existingByTitle = db.prepare(
          `SELECT id FROM anime WHERE LOWER(title) = LOWER(?) OR LOWER(title_romaji) = LOWER(?) OR LOWER(title_english) = LOWER(?)`
        ).get(series.Name, series.Name, series.Name);

        let animeId;

        if (existingByTitle) {
          // Already exists — just use the existing ID and sync episodes
          animeId = existingByTitle.id;
          seriesResult.status = 'updated';
        } else {
          // --- Step 2: Search AniList for metadata ---
          let animeData = null;
          try {
            const anilistPage = await searchAnilist(series.Name, 1, 5);
            if (anilistPage?.media?.length > 0) {
              // Pick the best match (first result is usually correct for exact names)
              const bestMatch = anilistPage.media[0];
              const fullMedia = await getAnilistAnime(bestMatch.id);
              animeData = formatAnilistData(fullMedia);
            }
          } catch (anilistErr) {
            console.warn(`AniList search failed for "${series.Name}":`, anilistErr.message);
          }

          // If AniList didn't return anything, create a basic entry from Jellyfin data
          if (!animeData) {
            animeData = {
              title: series.Name,
              title_romaji: series.Name,
              title_english: series.Name,
              description: '',
              cover_image: '',
              banner_image: '',
              genres: '[]',
              status: 'FINISHED',
              episodes_total: null,
              rating: null,
              year: series.ProductionYear || null,
              season: null,
              format: 'TV',
              studios: '[]',
              anilist_id: null,
            };
          }

          // --- Step 3: Insert the anime into our database ---
          const insertResult = db.prepare(`
            INSERT INTO anime (title, title_romaji, title_english, description, cover_image, banner_image,
              genres, status, episodes_total, rating, year, season, format, studios, anilist_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            animeData.title, animeData.title_romaji, animeData.title_english,
            animeData.description, animeData.cover_image, animeData.banner_image,
            animeData.genres, animeData.status, animeData.episodes_total,
            animeData.rating, animeData.year, animeData.season,
            animeData.format, animeData.studios, animeData.anilist_id
          );

          animeId = Number(insertResult.lastInsertRowid);
          seriesResult.status = 'created';
        }

        seriesResult.anime_id = animeId;

        // --- Step 4: Fetch episodes from Jellyfin ---
        const episodesData = await jellyfinFetch(
          `/Items?parentId=${series.Id}&recursive=true&IncludeItemTypes=Episode&fields=Path&sortBy=SortName&sortOrder=Ascending`
        );

        const jellyfinEpisodes = episodesData.Items || [];

        // Insert episodes that don't already exist
        const insertEp = db.prepare(`
          INSERT OR IGNORE INTO episodes (anime_id, episode_number, title, file_path, jellyfin_item_id)
          VALUES (?, ?, ?, ?, ?)
        `);

        let epsAdded = 0;
        for (const ep of jellyfinEpisodes) {
          const epNumber = ep.IndexNumber || 0;
          const epTitle = ep.Name || `Episode ${epNumber}`;
          const filePath = ep.Path || '';
          const jellyfinItemId = ep.Id;

          try {
            const result = insertEp.run(animeId, epNumber, epTitle, filePath, jellyfinItemId);
            if (result.changes > 0) epsAdded++;
          } catch (epErr) {
            // Duplicate episode — skip silently
          }
        }

        seriesResult.episodes_added = epsAdded;
        seriesResult.total_episodes = jellyfinEpisodes.length;

      } catch (seriesErr) {
        seriesResult.status = 'error';
        seriesResult.error = seriesErr.message;
      }

      results.push(seriesResult);
    }

    return NextResponse.json({
      synced: results.length,
      results,
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
