import { getDb } from './db';
import { searchAnilist, getAnilistAnime, formatAnilistData } from './anilist';
import { getEpisodeAirDateOverride } from './episode-overrides';
import { fetchJellyfinResource } from './jellyfin';
import { isJellyfinAnimeMoviePath } from './media-roots';

const LIBRARY_ITEM_TYPES = 'Series,Movie';
const LIBRARY_ITEM_FIELDS = [
  'Path',
  'Overview',
  'PremiereDate',
  'RunTimeTicks',
  'ProviderIds',
  'ProductionYear',
].join(',');
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isGenericEpisodeTitle(title, episodeNumber) {
  const text = String(title || '').trim();
  const numericEpisode = Number(episodeNumber);

  if (!text) return true;
  if (!Number.isFinite(numericEpisode)) return false;

  const episode = escapeRegex(String(numericEpisode));
  return new RegExp(`^(?:episode|ep\\.?|e)?\\s*0*${episode}$`, 'i').test(text);
}

function cleanExtractedEpisodeTitle(value) {
  const title = String(value || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\{[^}]*}/g, ' ')
    .replace(/\s*-\s*[A-Za-z0-9][A-Za-z0-9._-]{1,30}\s*$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s-]+|[\s-]+$/g, '');

  return title || null;
}

function episodeTitleFromPath(filePath, episodeNumber) {
  const fileName = String(filePath || '').split(/[\\/]/).pop() || '';
  const stem = fileName.replace(/\.[^.]+$/, '');
  const numericEpisode = Number(episodeNumber);

  if (!stem || !Number.isFinite(numericEpisode)) return null;

  const episode = escapeRegex(String(numericEpisode));
  const seasonEpisodePattern = new RegExp(`(?:^|[\\s._-])S\\d{1,3}E0*${episode}(?:\\b|[\\s._-])(?<rest>.*)$`, 'i');
  const seasonEpisodeMatch = stem.match(seasonEpisodePattern);

  if (seasonEpisodeMatch?.groups?.rest) {
    const candidate = cleanExtractedEpisodeTitle(
      seasonEpisodeMatch.groups.rest
        .replace(/^[\s._-]+/, '')
        .replace(/^\d{1,4}\s*[-_.]\s*/, '')
    );

    if (candidate && !isGenericEpisodeTitle(candidate, numericEpisode)) {
      return candidate;
    }
  }

  const parts = stem.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean);
  const seasonEpisodePart = new RegExp(`^S\\d{1,3}E0*${episode}(?:\\b|$)`, 'i');
  const episodePart = new RegExp(`^(?:episode|ep\\.?|e)?\\s*0*${episode}$`, 'i');
  const markerIndex = parts.findIndex(part => seasonEpisodePart.test(part) || episodePart.test(part));

  if (markerIndex >= 0) {
    for (const part of parts.slice(markerIndex + 1)) {
      if (/^\d{1,4}$/.test(part)) continue;

      const candidate = cleanExtractedEpisodeTitle(part);
      if (candidate && !isGenericEpisodeTitle(candidate, numericEpisode)) {
        return candidate;
      }
    }
  }

  return null;
}

function episodeTitleFromItem(ep, episodeNumber, { kind, sourceName }) {
  const jellyfinTitle = String(ep?.Name || '').trim();

  if (kind === 'movie') {
    return jellyfinTitle || sourceName;
  }

  if (!isGenericEpisodeTitle(jellyfinTitle, episodeNumber)) {
    return jellyfinTitle;
  }

  return episodeTitleFromPath(ep?.Path, episodeNumber)
    || jellyfinTitle
    || `Episode ${episodeNumber}`;
}

function serializeProviderIds(providerIds) {
  try {
    return JSON.stringify(providerIds || {});
  } catch {
    return '{}';
  }
}

function productionYearFromItem(item) {
  const productionYear = Number(item?.ProductionYear);
  if (Number.isFinite(productionYear) && productionYear > 0) return productionYear;

  const airDate = normalizeAirDate(item?.PremiereDate);
  const year = airDate ? Number(airDate.slice(0, 4)) : null;
  return Number.isFinite(year) && year > 0 ? year : null;
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

function itemKind(item) {
  return String(item?.Type || '').toLowerCase() === 'movie' ? 'movie' : 'series';
}

function formatLabelForKind(kind) {
  return kind === 'movie' ? 'MOVIE' : 'TV';
}

function formatPredicateForKind(kind) {
  return kind === 'movie'
    ? "UPPER(COALESCE(format, '')) = 'MOVIE'"
    : "(format IS NULL OR UPPER(COALESCE(format, '')) != 'MOVIE')";
}

function makePreviewItem(db, item) {
  const kind = itemKind(item);
  const existing = findExistingAnime(db, item, kind);

  return {
    jellyfin_id: item.Id,
    name: item.Name,
    path: item.Path,
    provider_ids: item.ProviderIds || {},
    item_type: kind,
    media_type: kind,
    already_exists: !!existing,
    existing_id: existing?.id || null,
  };
}

function fallbackAnimeData(item, kind) {
  return {
    title: item.Name,
    title_romaji: item.Name,
    title_english: item.Name,
    description: item.Overview || '',
    cover_image: '',
    banner_image: '',
    genres: '[]',
    status: 'FINISHED',
    episodes_total: kind === 'movie' ? 1 : null,
    rating: null,
    year: productionYearFromItem(item),
    season: null,
    format: formatLabelForKind(kind),
    studios: '[]',
    anilist_id: null,
  };
}

async function anilistDataForItem(item, kind) {
  const anilistPage = await searchAnilist(item.Name, 1, 5);
  const candidates = anilistPage?.media || [];
  const bestMatch = kind === 'movie'
    ? candidates.find(media => media.format === 'MOVIE') || candidates[0]
    : candidates.find(media => media.format !== 'MOVIE') || candidates[0];

  if (!bestMatch) return null;

  const fullMedia = await getAnilistAnime(bestMatch.id);
  const animeData = formatAnilistData(fullMedia);

  if (kind === 'movie') {
    animeData.format = 'MOVIE';
    animeData.episodes_total = animeData.episodes_total || 1;
  }

  return animeData;
}

function findExistingAnime(db, item, kind = itemKind(item)) {
  const existingByJellyfin = db.prepare('SELECT id, format FROM anime WHERE jellyfin_id = ?').get(item.Id);
  if (existingByJellyfin) return existingByJellyfin;

  return db.prepare(`
    SELECT id, format
    FROM anime
    WHERE (
      LOWER(title) = LOWER(?)
      OR LOWER(title_romaji) = LOWER(?)
      OR LOWER(title_english) = LOWER(?)
    )
    AND ${formatPredicateForKind(kind)}
    LIMIT 1
  `).get(item.Name, item.Name, item.Name);
}

function pruneMissingJellyfinItems(db, currentItemIds) {
  const currentIds = new Set(currentItemIds.filter(Boolean).map(String));
  const localJellyfinAnime = db.prepare(`
    SELECT id, title, jellyfin_id, format
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
    item_type: String(anime.format || '').toUpperCase() === 'MOVIE' ? 'movie' : 'series',
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

function episodeUpsertStatement(db) {
  return db.prepare(`
    INSERT INTO episodes (
      anime_id, episode_number, title, file_path, jellyfin_item_id, duration,
      air_date, overview, runtime_ticks, provider_ids, season_number, production_year
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(anime_id, episode_number) DO UPDATE SET
      title = CASE
        WHEN episodes.manual_metadata = 1 THEN episodes.title
        WHEN episodes.title IS NULL
          OR TRIM(episodes.title) = ''
          OR LOWER(TRIM(episodes.title)) = LOWER('Episode ' || episodes.episode_number)
          OR LOWER(TRIM(episodes.title)) = LOWER('Ep ' || episodes.episode_number)
          OR LOWER(TRIM(episodes.title)) = LOWER('E' || episodes.episode_number)
          OR TRIM(episodes.title) = CAST(episodes.episode_number AS TEXT)
          OR TRIM(episodes.title) = printf('%02d', episodes.episode_number)
        THEN COALESCE(NULLIF(excluded.title, ''), episodes.title)
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
}

async function jellyfinFetch(endpoint) {
  const res = await fetchJellyfinResource(endpoint, {
    headers: { Accept: 'application/json' },
  });
  return res.json();
}

async function fetchLibraryItems() {
  const data = await jellyfinFetch(itemsEndpoint({
    recursive: 'true',
    IncludeItemTypes: LIBRARY_ITEM_TYPES,
    fields: LIBRARY_ITEM_FIELDS,
  }));

  return (data.Items || []).filter(item => {
    const kind = itemKind(item);
    return kind === 'series' || isJellyfinAnimeMoviePath(item.Path);
  });
}

async function ensureAnimeForJellyfinItem(db, item, result) {
  const kind = itemKind(item);
  const existing = findExistingAnime(db, item, kind);

  if (existing) {
    db.prepare(`
      UPDATE anime
      SET jellyfin_id = ?
      WHERE id = ? AND (jellyfin_id IS NULL OR TRIM(jellyfin_id) = '')
    `).run(item.Id, existing.id);

    return {
      animeId: existing.id,
      status: 'updated',
    };
  }

  let animeData = null;
  try {
    animeData = await anilistDataForItem(item, kind);
  } catch (anilistErr) {
    console.warn(`AniList search failed for "${item.Name}":`, anilistErr.message);
  }

  if (!animeData) {
    animeData = fallbackAnimeData(item, kind);
  }

  let existingByAnilist = null;
  if (animeData?.anilist_id) {
    existingByAnilist = db.prepare('SELECT id FROM anime WHERE anilist_id = ?').get(animeData.anilist_id);
  }

  if (existingByAnilist) {
    db.prepare(`
      UPDATE anime
      SET jellyfin_id = ?
      WHERE id = ? AND (jellyfin_id IS NULL OR TRIM(jellyfin_id) = '')
    `).run(item.Id, existingByAnilist.id);

    return {
      animeId: existingByAnilist.id,
      status: 'updated',
    };
  }

  const insertResult = db.prepare(`
    INSERT INTO anime (title, title_romaji, title_english, description, cover_image, banner_image,
      genres, status, episodes_total, rating, year, season, format, studios, anilist_id, jellyfin_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    animeData.title, animeData.title_romaji, animeData.title_english,
    animeData.description, animeData.cover_image, animeData.banner_image,
    animeData.genres, animeData.status, animeData.episodes_total,
    animeData.rating, animeData.year, animeData.season,
    animeData.format || formatLabelForKind(kind), animeData.studios, animeData.anilist_id, item.Id
  );

  result.anilist_id = animeData.anilist_id || null;

  return {
    animeId: Number(insertResult.lastInsertRowid),
    status: 'created',
  };
}

function syncEpisodeRows(db, { animeId, sourceName, animeRecord, episodeItems, kind }) {
  const existingEpisode = db.prepare('SELECT id FROM episodes WHERE anime_id = ? AND episode_number = ?');
  const upsertEp = episodeUpsertStatement(db);
  let epsAdded = 0;
  let epsUpdated = 0;

  for (const [index, ep] of episodeItems.entries()) {
    const epNumber = kind === 'movie'
      ? 1
      : Number(ep.IndexNumber) > 0 ? Number(ep.IndexNumber) : index + 1;
    const epTitle = episodeTitleFromItem(ep, epNumber, { kind, sourceName });
    const airDateOverride = kind === 'series'
      ? getEpisodeAirDateOverride({
        anilistId: animeRecord?.anilist_id,
        title: animeRecord?.title || animeRecord?.title_romaji || animeRecord?.title_english || sourceName,
      }, epNumber)
      : null;
    const metadata = episodeMetadata(ep, airDateOverride);

    try {
      const alreadyExists = existingEpisode.get(animeId, epNumber);
      upsertEp.run(
        animeId,
        epNumber,
        epTitle,
        ep.Path || '',
        ep.Id,
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

  const currentEpisodeIds = episodeItems.map(ep => ep.Id);
  const removedEpisodes = currentEpisodeIds.length > 0
    ? pruneMissingJellyfinEpisodes(db, animeId, currentEpisodeIds)
    : [];

  return {
    episodes_added: epsAdded,
    episodes_updated: epsUpdated,
    episodes_removed: removedEpisodes.length,
    removed_episodes: removedEpisodes,
    total_episodes: episodeItems.length,
  };
}

async function syncSeriesEpisodes(db, series, animeId, animeRecord) {
  const episodesData = await jellyfinFetch(itemsEndpoint({
    parentId: series.Id,
    recursive: 'true',
    IncludeItemTypes: 'Episode',
    fields: EPISODE_FIELDS,
    sortBy: 'ParentIndexNumber,IndexNumber,SortName',
    sortOrder: 'Ascending',
  }));

  return syncEpisodeRows(db, {
    animeId,
    sourceName: series.Name,
    animeRecord,
    episodeItems: episodesData.Items || [],
    kind: 'series',
  });
}

function syncMovieFile(db, movie, animeId, animeRecord) {
  return syncEpisodeRows(db, {
    animeId,
    sourceName: movie.Name,
    animeRecord,
    episodeItems: [movie],
    kind: 'movie',
  });
}

export async function getSyncPreview() {
  const db = getDb();
  const jellyfinItems = await fetchLibraryItems();
  const jellyfinItemIds = new Set(jellyfinItems.map(item => String(item.Id)));
  const existingAnime = db.prepare('SELECT * FROM anime').all();
  const preview = jellyfinItems.map(item => makePreviewItem(db, item));
  const staleItems = existingAnime
    .filter(anime => anime.jellyfin_id && !jellyfinItemIds.has(String(anime.jellyfin_id)))
    .map(anime => ({
      anime_id: anime.id,
      title: anime.title,
      jellyfin_id: anime.jellyfin_id,
      item_type: String(anime.format || '').toUpperCase() === 'MOVIE' ? 'movie' : 'series',
      status: 'missing_in_jellyfin',
    }));

  return {
    total: preview.length,
    series_count: preview.filter(p => p.item_type === 'series').length,
    movie_count: preview.filter(p => p.item_type === 'movie').length,
    new_count: preview.filter(p => !p.already_exists).length,
    existing_count: preview.filter(p => p.already_exists).length,
    removed_count: staleItems.length,
    stale_series: staleItems,
    stale_items: staleItems,
    series: preview,
    items: preview,
  };
}

export async function syncJellyfinLibrary({ jellyfinIds = [], syncAll = false } = {}) {
  const db = getDb();
  let itemsToSync = [];

  if (syncAll) {
    itemsToSync = await fetchLibraryItems();
  } else if (jellyfinIds?.length > 0) {
    const requestedIds = new Set(jellyfinIds.map(String));
    itemsToSync = (await fetchLibraryItems()).filter(item => requestedIds.has(String(item.Id)));
  } else {
    throw new Error('Provide jellyfin_ids or sync_all');
  }

  const results = [];

  for (const item of itemsToSync) {
    const kind = itemKind(item);
    const itemResult = {
      jellyfin_id: item.Id,
      name: item.Name,
      item_type: kind,
      media_type: kind,
      status: 'pending',
      anime_id: null,
      anilist_id: null,
      episodes_added: 0,
      episodes_updated: 0,
      episodes_removed: 0,
      removed_episodes: [],
      total_episodes: 0,
      error: null,
    };

    try {
      const animeState = await ensureAnimeForJellyfinItem(db, item, itemResult);
      itemResult.anime_id = animeState.animeId;
      itemResult.status = animeState.status;

      const animeRecord = db.prepare(`
        SELECT anilist_id, title, title_romaji, title_english
        FROM anime
        WHERE id = ?
      `).get(animeState.animeId);
      const episodeStats = kind === 'movie'
        ? syncMovieFile(db, item, animeState.animeId, animeRecord)
        : await syncSeriesEpisodes(db, item, animeState.animeId, animeRecord);

      Object.assign(itemResult, episodeStats);
    } catch (itemErr) {
      itemResult.status = 'error';
      itemResult.error = itemErr.message;
    }

    results.push(itemResult);
  }

  const removedItems = syncAll && itemsToSync.length > 0
    ? pruneMissingJellyfinItems(db, itemsToSync.map(item => item.Id))
    : [];

  return {
    synced: results.length,
    removed_count: removedItems.length,
    removed_series: removedItems,
    removed_items: removedItems,
    results,
  };
}
