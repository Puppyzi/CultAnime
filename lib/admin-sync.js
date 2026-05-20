import { getDb } from './db';
import { searchAnilist, getAnilistAnime, formatAnilistData } from './anilist';
import { getEpisodeAirDateOverride } from './episode-overrides';
import { fetchJellyfinResource } from './jellyfin';

const SERIES_FIELDS = 'Path,ProviderIds,ProductionYear';
const EPISODE_FIELDS = [
  'Path',
  'Overview',
  'PremiereDate',
  'RunTimeTicks',
  'ProviderIds',
  'ProductionYear',
  'ParentIndexNumber',
  'IndexNumber',
].join(',');
const TICKS_PER_SECOND = 10000000;

function itemsEndpoint(params) {
  return `/Items?${queryString(params)}`;
}

function queryString(params) {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeQueryValue(value)}`)
    .join('&');
}

function encodeQueryValue(value) {
  return encodeURIComponent(value).replace(/%2C/g, ',');
}

function normalizeAirDate(value) {
  if (!value) return null;

  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString().slice(0, 10);
}

function runtimeSeconds(runTimeTicks) {
  if (!runTimeTicks) return null;
  const seconds = Math.round(Number(runTimeTicks) / TICKS_PER_SECOND);
  return Number.isFinite(seconds) ? seconds : null;
}

function serializeProviderIds(providerIds) {
  try {
    return JSON.stringify(providerIds || {});
  } catch {
    return '{}';
  }
}

function episodeMetadata(ep, airDateOverride = null) {
  return {
    airDate: airDateOverride || normalizeAirDate(ep.PremiereDate),
    overview: ep.Overview || null,
    runtimeTicks: ep.RunTimeTicks || null,
    duration: runtimeSeconds(ep.RunTimeTicks),
    providerIds: serializeProviderIds(ep.ProviderIds),
    seasonNumber: ep.ParentIndexNumber || null,
    productionYear: ep.ProductionYear || null,
  };
}

function pruneMissingJellyfinSeries(db, currentSeriesIds) {
  const currentIds = new Set(currentSeriesIds.filter(Boolean).map(String));
  const localJellyfinAnime = db.prepare(`
    SELECT id, title, jellyfin_id
    FROM anime
    WHERE jellyfin_id IS NOT NULL AND TRIM(jellyfin_id) != ''
  `).all();
  const staleAnime = localJellyfinAnime.filter(anime => !currentIds.has(String(anime.jellyfin_id)));
  const deleteAnime = db.prepare('DELETE FROM anime WHERE id = ?');

  for (const anime of staleAnime) {
    deleteAnime.run(anime.id);
  }

  return staleAnime.map(anime => ({
    anime_id: anime.id,
    title: anime.title,
    jellyfin_id: anime.jellyfin_id,
    status: 'removed',
  }));
}

function pruneMissingJellyfinEpisodes(db, animeId, currentEpisodeIds) {
  const currentIds = new Set(currentEpisodeIds.filter(Boolean).map(String));
  const localJellyfinEpisodes = db.prepare(`
    SELECT id, episode_number, title, jellyfin_item_id
    FROM episodes
    WHERE anime_id = ? AND jellyfin_item_id IS NOT NULL AND TRIM(jellyfin_item_id) != ''
  `).all(animeId);
  const staleEpisodes = localJellyfinEpisodes.filter(episode => !currentIds.has(String(episode.jellyfin_item_id)));
  const deleteEpisode = db.prepare('DELETE FROM episodes WHERE id = ?');

  for (const episode of staleEpisodes) {
    deleteEpisode.run(episode.id);
  }

  return staleEpisodes.map(episode => ({
    episode_id: episode.id,
    episode_number: episode.episode_number,
    title: episode.title,
    jellyfin_item_id: episode.jellyfin_item_id,
  }));
}

async function jellyfinFetch(endpoint) {
  const res = await fetchJellyfinResource(endpoint, {
    headers: { Accept: 'application/json' },
  });
  return res.json();
}

export async function getSyncPreview() {
  const db = getDb();

  const data = await jellyfinFetch(itemsEndpoint({
    recursive: 'true',
    IncludeItemTypes: 'Series',
    fields: SERIES_FIELDS,
  }));

  const jellyfinSeries = data.Items || [];
  const jellyfinSeriesIds = new Set(jellyfinSeries.map(series => String(series.Id)));
  const existingAnime = db.prepare('SELECT * FROM anime').all();
  const existingByTitle = new Map();
  const existingByJellyfinId = new Map();

  existingAnime.forEach(a => {
    if (a.jellyfin_id) existingByJellyfinId.set(a.jellyfin_id, a);
    existingByTitle.set(a.title?.toLowerCase(), a);
    if (a.title_romaji) existingByTitle.set(a.title_romaji.toLowerCase(), a);
    if (a.title_english) existingByTitle.set(a.title_english.toLowerCase(), a);
  });

  const preview = jellyfinSeries.map(series => {
    const name = series.Name || '';
    const existing = existingByJellyfinId.get(series.Id) || existingByTitle.get(name.toLowerCase());

    return {
      jellyfin_id: series.Id,
      name: series.Name,
      path: series.Path,
      provider_ids: series.ProviderIds || {},
      already_exists: !!existing,
      existing_id: existing?.id || null,
    };
  });
  const staleSeries = existingAnime
    .filter(anime => anime.jellyfin_id && !jellyfinSeriesIds.has(String(anime.jellyfin_id)))
    .map(anime => ({
      anime_id: anime.id,
      title: anime.title,
      jellyfin_id: anime.jellyfin_id,
      status: 'missing_in_jellyfin',
    }));

  return {
    total: preview.length,
    new_count: preview.filter(p => !p.already_exists).length,
    existing_count: preview.filter(p => p.already_exists).length,
    removed_count: staleSeries.length,
    stale_series: staleSeries,
    series: preview,
  };
}

export async function syncJellyfinLibrary({ jellyfinIds = [], syncAll = false } = {}) {
  const db = getDb();
  let seriesToSync = [];

  if (syncAll) {
    const data = await jellyfinFetch(itemsEndpoint({
      recursive: 'true',
      IncludeItemTypes: 'Series',
      fields: SERIES_FIELDS,
    }));
    seriesToSync = data.Items || [];
  } else if (jellyfinIds?.length > 0) {
    const requestedIds = new Set(jellyfinIds);
    const data = await jellyfinFetch(itemsEndpoint({
      recursive: 'true',
      IncludeItemTypes: 'Series',
      fields: SERIES_FIELDS,
    }));
    seriesToSync = (data.Items || []).filter(item => requestedIds.has(item.Id));
  } else {
    throw new Error('Provide jellyfin_ids or sync_all');
  }

  const results = [];

  for (const series of seriesToSync) {
    const seriesResult = {
      jellyfin_id: series.Id,
      name: series.Name,
      status: 'pending',
      anime_id: null,
      episodes_added: 0,
      episodes_updated: 0,
      episodes_removed: 0,
      removed_episodes: [],
      error: null,
    };

    try {
      const existingByJellyfin = db.prepare('SELECT id FROM anime WHERE jellyfin_id = ?').get(series.Id);
      const existingByTitle = db.prepare(
        'SELECT id FROM anime WHERE LOWER(title) = LOWER(?) OR LOWER(title_romaji) = LOWER(?) OR LOWER(title_english) = LOWER(?)'
      ).get(series.Name, series.Name, series.Name);

      let animeId;

      if (existingByJellyfin || existingByTitle) {
        animeId = existingByJellyfin?.id || existingByTitle.id;
        seriesResult.status = 'updated';
        db.prepare('UPDATE anime SET jellyfin_id = ? WHERE id = ? AND jellyfin_id IS NULL').run(series.Id, animeId);
      } else {
        let animeData = null;
        try {
          const anilistPage = await searchAnilist(series.Name, 1, 5);
          if (anilistPage?.media?.length > 0) {
            const bestMatch = anilistPage.media[0];
            const fullMedia = await getAnilistAnime(bestMatch.id);
            animeData = formatAnilistData(fullMedia);
          }
        } catch (anilistErr) {
          console.warn(`AniList search failed for "${series.Name}":`, anilistErr.message);
        }

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

        let existingByAnilist = null;
        if (animeData?.anilist_id) {
          existingByAnilist = db.prepare('SELECT id FROM anime WHERE anilist_id = ?').get(animeData.anilist_id);
        }

        if (existingByAnilist) {
          animeId = existingByAnilist.id;
          seriesResult.status = 'updated';
          db.prepare('UPDATE anime SET jellyfin_id = ? WHERE id = ? AND jellyfin_id IS NULL').run(series.Id, animeId);
        } else {
          const insertResult = db.prepare(`
            INSERT INTO anime (title, title_romaji, title_english, description, cover_image, banner_image,
              genres, status, episodes_total, rating, year, season, format, studios, anilist_id, jellyfin_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            animeData.title, animeData.title_romaji, animeData.title_english,
            animeData.description, animeData.cover_image, animeData.banner_image,
            animeData.genres, animeData.status, animeData.episodes_total,
            animeData.rating, animeData.year, animeData.season,
            animeData.format, animeData.studios, animeData.anilist_id, series.Id
          );

          animeId = Number(insertResult.lastInsertRowid);
          seriesResult.status = 'created';
        }
      }

      seriesResult.anime_id = animeId;
      const animeRecord = db.prepare(`
        SELECT anilist_id, title, title_romaji, title_english
        FROM anime
        WHERE id = ?
      `).get(animeId);

      const episodesData = await jellyfinFetch(itemsEndpoint({
        parentId: series.Id,
        recursive: 'true',
        IncludeItemTypes: 'Episode',
        fields: EPISODE_FIELDS,
        sortBy: 'ParentIndexNumber,IndexNumber,SortName',
        sortOrder: 'Ascending',
      }));

      const jellyfinEpisodes = episodesData.Items || [];
      const currentEpisodeIds = jellyfinEpisodes.map(ep => ep.Id);
      const existingEpisode = db.prepare('SELECT id FROM episodes WHERE anime_id = ? AND episode_number = ?');
      const upsertEp = db.prepare(`
        INSERT INTO episodes (
          anime_id, episode_number, title, file_path, jellyfin_item_id, duration,
          air_date, overview, runtime_ticks, provider_ids, season_number, production_year
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(anime_id, episode_number) DO UPDATE SET
          title = CASE
            WHEN episodes.title IS NULL OR TRIM(episodes.title) = '' OR episodes.title = ('Episode ' || episodes.episode_number)
            THEN COALESCE(excluded.title, episodes.title)
            ELSE episodes.title
          END,
          file_path = COALESCE(NULLIF(excluded.file_path, ''), episodes.file_path),
          jellyfin_item_id = COALESCE(excluded.jellyfin_item_id, episodes.jellyfin_item_id),
          duration = CASE
            WHEN episodes.manual_metadata = 1 THEN episodes.duration
            ELSE COALESCE(excluded.duration, episodes.duration)
          END,
          air_date = CASE
            WHEN episodes.manual_metadata = 1 THEN episodes.air_date
            ELSE COALESCE(excluded.air_date, episodes.air_date)
          END,
          overview = CASE
            WHEN episodes.manual_metadata = 1 THEN episodes.overview
            ELSE COALESCE(excluded.overview, episodes.overview)
          END,
          runtime_ticks = CASE
            WHEN episodes.manual_metadata = 1 THEN episodes.runtime_ticks
            ELSE COALESCE(excluded.runtime_ticks, episodes.runtime_ticks)
          END,
          provider_ids = COALESCE(excluded.provider_ids, episodes.provider_ids),
          season_number = COALESCE(excluded.season_number, episodes.season_number),
          production_year = COALESCE(excluded.production_year, episodes.production_year)
      `);

      let epsAdded = 0;
      let epsUpdated = 0;

      for (const [index, ep] of jellyfinEpisodes.entries()) {
        const epNumber = Number(ep.IndexNumber) > 0 ? Number(ep.IndexNumber) : index + 1;
        const epTitle = ep.Name || `Episode ${epNumber}`;
        const filePath = ep.Path || '';
        const jellyfinItemId = ep.Id;
        const airDateOverride = getEpisodeAirDateOverride({
          anilistId: animeRecord?.anilist_id,
          title: animeRecord?.title || animeRecord?.title_romaji || animeRecord?.title_english || series.Name,
        }, epNumber);
        const metadata = episodeMetadata(ep, airDateOverride);

        try {
          const alreadyExists = existingEpisode.get(animeId, epNumber);
          upsertEp.run(
            animeId,
            epNumber,
            epTitle,
            filePath,
            jellyfinItemId,
            metadata.duration,
            metadata.airDate,
            metadata.overview,
            metadata.runtimeTicks,
            metadata.providerIds,
            metadata.seasonNumber,
            metadata.productionYear
          );

          if (alreadyExists) {
            epsUpdated++;
          } else {
            epsAdded++;
          }
        } catch {
          // Duplicate episode - skip silently.
        }
      }

      const removedEpisodes = pruneMissingJellyfinEpisodes(db, animeId, currentEpisodeIds);

      seriesResult.episodes_added = epsAdded;
      seriesResult.episodes_updated = epsUpdated;
      seriesResult.episodes_removed = removedEpisodes.length;
      seriesResult.removed_episodes = removedEpisodes;
      seriesResult.total_episodes = jellyfinEpisodes.length;
    } catch (seriesErr) {
      seriesResult.status = 'error';
      seriesResult.error = seriesErr.message;
    }

    results.push(seriesResult);
  }

  const removedSeries = syncAll
    ? pruneMissingJellyfinSeries(db, seriesToSync.map(series => series.Id))
    : [];

  return {
    synced: results.length,
    removed_count: removedSeries.length,
    removed_series: removedSeries,
    results,
  };
}
