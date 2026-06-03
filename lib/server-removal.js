import { getDb } from './db';
import { fetchJellyfinResource } from './jellyfin';
import { SeerrApiError, seerrFetch } from './seerr';

const DEFAULT_TIMEOUT_MS = 20000;

export class ServerRemovalError extends Error {
  constructor(message, status = 500, payload = null) {
    super(message);
    this.name = 'ServerRemovalError';
    this.status = status;
    this.payload = payload;
  }
}

function trim(value) {
  return String(value || '').trim();
}

function numberFromEnv(...names) {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isInteger(value) && value >= 0) return value;
  }

  return null;
}

function boolFromEnv(name, fallback) {
  const value = trim(process.env[name]).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function normalizeBaseUrl(value) {
  const raw = trim(value);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function serverSettingBaseUrl(setting) {
  const hostname = trim(setting?.hostname || setting?.host);
  const apiBase = trim(setting?.baseUrl || setting?.urlBase || setting?.basePath);
  const pathPart = apiBase ? `/${apiBase.replace(/^\/+|\/+$/g, '')}` : '';

  if (!hostname) return null;

  if (/^https?:\/\//i.test(hostname)) {
    try {
      const url = new URL(hostname);
      if (setting?.port && !url.port) {
        url.port = String(setting.port);
      }
      url.pathname = `${url.pathname.replace(/\/+$/, '')}${pathPart}`;
      return url.toString().replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  const protocol = setting?.useSsl ? 'https' : 'http';
  const port = setting?.port ? `:${setting.port}` : '';
  return normalizeBaseUrl(`${protocol}://${hostname}${port}${pathPart}`);
}

function directServerConfig(kind) {
  const prefix = kind === 'sonarr' ? 'SONARR' : 'RADARR';
  const baseUrl = normalizeBaseUrl(
    process.env[`${prefix}_URL`] ||
    process.env[`${prefix}_BASE_URL`]
  );
  const apiKey = trim(process.env[`${prefix}_API_KEY`]);

  if (!baseUrl || !apiKey) return [];

  return [{
    kind,
    id: `${kind}:env`,
    name: `${prefix} (env)`,
    baseUrl,
    apiKey,
    source: 'env',
  }];
}

function serverIdEnv(kind) {
  if (kind === 'sonarr') {
    return numberFromEnv('SONARR_SERVER_ID', 'SEERR_SONARR_SERVER_ID', 'SEERR_ANIME_SONARR_SERVER_ID');
  }

  return numberFromEnv(
    'RADARR_SERVER_ID',
    'SEERR_RADARR_SERVER_ID',
    'SEERR_ANIME_MOVIE_RADARR_SERVER_ID',
    'SEERR_MOVIE_RADARR_SERVER_ID'
  );
}

async function seerrServerConfigs(kind) {
  let settings;

  try {
    settings = await seerrFetch(`/api/v1/settings/${kind}`);
  } catch (error) {
    if (error instanceof SeerrApiError && error.status === 503) return [];
    throw error;
  }

  const selectedId = serverIdEnv(kind);
  const items = Array.isArray(settings) ? settings : [settings].filter(Boolean);

  return items
    .filter(setting => selectedId === null || Number(setting?.id) === selectedId)
    .map(setting => ({
      kind,
      id: `${kind}:seerr:${setting.id ?? setting.name ?? 'unknown'}`,
      name: setting.name || `${kind} via Seerr`,
      baseUrl: serverSettingBaseUrl(setting),
      apiKey: trim(setting.apiKey),
      source: 'seerr',
    }))
    .filter(server => server.baseUrl && server.apiKey);
}

async function managedServers(kind) {
  const directServers = directServerConfig(kind);
  let seerrServers = [];

  try {
    seerrServers = await seerrServerConfigs(kind);
  } catch (error) {
    if (directServers.length === 0) throw error;
  }

  const servers = [
    ...directServers,
    ...seerrServers,
  ];
  const seen = new Set();

  return servers.filter(server => {
    const key = `${server.kind}:${server.baseUrl}:${server.apiKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readPayload(res) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function payloadMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.error === 'string') return payload.error;
  if (Array.isArray(payload.errors) && payload.errors[0]?.message) return payload.errors[0].message;
  return fallback;
}

async function arrFetch(server, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${server.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'X-Api-Key': server.apiKey,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const payload = await readPayload(res);

    if (!res.ok) {
      throw new ServerRemovalError(
        payloadMessage(payload, `${server.name} API error (${res.status})`),
        res.status,
        payload
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof ServerRemovalError) throw error;
    if (error.name === 'AbortError') {
      throw new ServerRemovalError(`${server.name} took too long to respond.`, 504);
    }
    throw new ServerRemovalError(`Could not reach ${server.name}: ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeArrList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.records)) return payload.records;
  if (payload && typeof payload === 'object' && payload.id !== undefined) return [payload];
  return [];
}

function sourceJellyfinId(jellyfinId) {
  const value = trim(jellyfinId);
  return value.includes(':season:') ? value.split(':season:')[0] : value;
}

function seasonFromJellyfinId(jellyfinId) {
  const match = trim(jellyfinId).match(/:season:(\d+)$/);
  if (!match) return null;

  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function uniqueNumbers(values) {
  return [...new Set(values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0))];
}

function parseProviderIds(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function mergeProviderIds(...providers) {
  const merged = {};

  for (const providerIds of providers) {
    for (const [key, value] of Object.entries(parseProviderIds(providerIds))) {
      if (value !== null && value !== undefined && trim(value) && !merged[key]) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

function providerValue(providerIds, ...names) {
  const entries = Object.entries(parseProviderIds(providerIds));

  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match && trim(match[1])) return trim(match[1]);
  }

  return null;
}

function normalizeMediaPath(value) {
  return trim(value)
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function baseName(value) {
  const normalized = normalizeMediaPath(value);
  return normalized ? normalized.split('/').pop() : '';
}

function mediaPathMatches(left, right) {
  const a = normalizeMediaPath(left);
  const b = normalizeMediaPath(right);
  if (!a || !b) return false;

  return a === b
    || a.startsWith(`${b}/`)
    || b.startsWith(`${a}/`)
    || a.endsWith(`/${b}`)
    || b.endsWith(`/${a}`);
}

function anyPathMatches(path, candidates) {
  return candidates.some(candidate => mediaPathMatches(path, candidate));
}

function anyBaseNameMatches(path, candidates) {
  const fileName = baseName(path);
  return Boolean(fileName && candidates.some(candidate => baseName(candidate) === fileName));
}

function titleKey(value) {
  return trim(value)
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function targetTitleMatches(item, target) {
  const targetTitles = [
    target.anime.title,
    target.anime.title_romaji,
    target.anime.title_english,
  ].map(titleKey).filter(Boolean);
  const itemTitles = [
    item.title,
    item.name,
    item.sortTitle,
    item.titleSlug,
  ].map(titleKey).filter(Boolean);

  return targetTitles.some(title => itemTitles.includes(title));
}

async function fetchJellyfinItem(itemId) {
  if (!itemId) return null;

  try {
    const res = await fetchJellyfinResource(
      `/Items/${encodeURIComponent(itemId)}?Fields=Path,ProviderIds,PremiereDate,ProductionYear`,
      { headers: { Accept: 'application/json' } }
    );
    return await res.json();
  } catch {
    return null;
  }
}

export async function buildRemovalTarget(animeId) {
  const db = getDb();
  const id = Number(animeId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ServerRemovalError('A valid anime ID is required.', 400);
  }

  const anime = db.prepare('SELECT * FROM anime WHERE id = ?').get(id);
  if (!anime) {
    throw new ServerRemovalError('Anime not found.', 404);
  }

  const episodes = db.prepare(`
    SELECT *
    FROM episodes
    WHERE anime_id = ?
    ORDER BY episode_number ASC
  `).all(id);

  const format = trim(anime.format).toUpperCase();
  const mediaType = format === 'MOVIE' ? 'movie' : 'series';
  const episodeSeasons = uniqueNumbers(episodes.map(episode => episode.season_number));
  const seasonNumber = seasonFromJellyfinId(anime.jellyfin_id)
    || (episodeSeasons.length === 1 ? episodeSeasons[0] : null);
  const sourceId = sourceJellyfinId(anime.jellyfin_id);
  const seriesOrMovieItem = await fetchJellyfinItem(sourceId);
  const firstEpisodeItemId = episodes.find(episode => trim(episode.jellyfin_item_id))?.jellyfin_item_id;
  const episodeJellyfinItem = mediaType === 'movie' ? await fetchJellyfinItem(firstEpisodeItemId) : null;
  const providerIds = mergeProviderIds(
    seriesOrMovieItem?.ProviderIds,
    episodeJellyfinItem?.ProviderIds,
    ...episodes.map(episode => episode.provider_ids)
  );
  const filePaths = [...new Set(episodes.map(episode => trim(episode.file_path)).filter(Boolean))];
  const jellyfinPaths = [...new Set([
    trim(seriesOrMovieItem?.Path),
    trim(episodeJellyfinItem?.Path),
    ...filePaths,
  ].filter(Boolean))];

  return {
    anime,
    episodes,
    anime_id: id,
    title: anime.title,
    media_type: mediaType,
    format,
    season_number: seasonNumber,
    source_jellyfin_id: sourceId || null,
    provider_ids: providerIds,
    tvdb_id: providerValue(providerIds, 'Tvdb', 'TVDB'),
    tmdb_id: providerValue(providerIds, 'Tmdb', 'TMDB'),
    imdb_id: providerValue(providerIds, 'Imdb', 'IMDB'),
    file_paths: filePaths,
    jellyfin_paths: jellyfinPaths,
    episode_count: episodes.length,
  };
}

function movieMatchesTarget(movie, target) {
  if (target.tmdb_id && Number(movie.tmdbId) === Number(target.tmdb_id)) return true;
  if (target.imdb_id && trim(movie.imdbId).toLowerCase() === target.imdb_id.toLowerCase()) return true;
  if (target.jellyfin_paths.length > 0 && anyPathMatches(movie.path, target.jellyfin_paths)) return true;
  return targetTitleMatches(movie, target);
}

function seriesMatchesTarget(series, target) {
  if (target.tvdb_id && Number(series.tvdbId) === Number(target.tvdb_id)) return true;
  if (target.jellyfin_paths.length > 0 && anyPathMatches(series.path, target.jellyfin_paths)) return true;
  return targetTitleMatches(series, target);
}

async function findMovieInRadarr(target, servers) {
  for (const server of servers) {
    const candidates = [];

    if (target.tmdb_id) {
      try {
        candidates.push(...normalizeArrList(await arrFetch(
          server,
          `/api/v3/movie?tmdbId=${encodeURIComponent(target.tmdb_id)}`
        )));
      } catch {
        // Fall back to a full list below. Some Radarr versions ignore tmdbId lookups.
      }
    }

    if (candidates.length === 0) {
      candidates.push(...normalizeArrList(await arrFetch(server, '/api/v3/movie')));
    }

    const movie = candidates.find(candidate => movieMatchesTarget(candidate, target));
    if (movie) return { server, movie };
  }

  return null;
}

async function findSeriesInSonarr(target, servers) {
  for (const server of servers) {
    const candidates = [];

    if (target.tvdb_id) {
      try {
        candidates.push(...normalizeArrList(await arrFetch(
          server,
          `/api/v3/series?tvdbId=${encodeURIComponent(target.tvdb_id)}`
        )));
      } catch {
        // Fall back to a full list below. Some Sonarr versions ignore tvdbId lookups.
      }
    }

    if (candidates.length === 0) {
      candidates.push(...normalizeArrList(await arrFetch(server, '/api/v3/series')));
    }

    const series = candidates.find(candidate => seriesMatchesTarget(candidate, target));
    if (series) return { server, series };
  }

  return null;
}

function episodeFileMatchesTarget(file, target) {
  const filePath = file.path || file.relativePath || '';
  const seasonMatches = target.season_number
    ? Number(file.seasonNumber) === Number(target.season_number)
    : true;

  if (target.file_paths.length > 0) {
    return seasonMatches && (
      anyPathMatches(filePath, target.file_paths) ||
      anyBaseNameMatches(filePath, target.file_paths)
    );
  }

  return seasonMatches && Boolean(target.season_number);
}

async function deleteSonarrEpisodeFile(server, file) {
  await arrFetch(server, `/api/v3/episodefile/${encodeURIComponent(file.id)}`, {
    method: 'DELETE',
  });
}

async function unmonitorSonarrSeason(server, series, seasonNumber) {
  if (!seasonNumber || !Array.isArray(series.seasons)) return false;

  const nextSeries = JSON.parse(JSON.stringify(series));
  let changed = false;

  nextSeries.seasons = nextSeries.seasons.map(season => {
    if (Number(season.seasonNumber) !== Number(seasonNumber) || season.monitored === false) {
      return season;
    }

    changed = true;
    return { ...season, monitored: false };
  });

  if (!changed) return false;

  await arrFetch(server, `/api/v3/series/${encodeURIComponent(series.id)}`, {
    method: 'PUT',
    body: nextSeries,
  });

  return true;
}

async function removeMovieFromServer(target) {
  const servers = await managedServers('radarr');
  if (servers.length === 0) {
    throw new ServerRemovalError('Radarr is not configured. Set RADARR_URL/RADARR_API_KEY or connect Radarr in Seerr.', 503);
  }

  const match = await findMovieInRadarr(target, servers);
  if (!match) {
    throw new ServerRemovalError(`Could not find "${target.title}" in Radarr.`, 404);
  }

  await arrFetch(
    match.server,
    `/api/v3/movie/${encodeURIComponent(match.movie.id)}?deleteFiles=true&addImportExclusion=false`,
    { method: 'DELETE' }
  );

  return {
    anime_id: target.anime_id,
    title: target.title,
    media_type: 'movie',
    scope: 'movie',
    downloader: 'radarr',
    server_name: match.server.name,
    managed_id: match.movie.id,
    deleted_files: match.movie.movieFile ? 1 : target.episode_count,
    unmonitored: false,
    jellyfin_paths: target.jellyfin_paths,
  };
}

async function removeSeriesFromServer(target) {
  const servers = await managedServers('sonarr');
  if (servers.length === 0) {
    throw new ServerRemovalError('Sonarr is not configured. Set SONARR_URL/SONARR_API_KEY or connect Sonarr in Seerr.', 503);
  }

  const match = await findSeriesInSonarr(target, servers);
  if (!match) {
    throw new ServerRemovalError(`Could not find "${target.title}" in Sonarr.`, 404);
  }

  const seasonNumber = target.season_number;

  if (!seasonNumber) {
    await arrFetch(
      match.server,
      `/api/v3/series/${encodeURIComponent(match.series.id)}?deleteFiles=true&addImportListExclusion=false`,
      { method: 'DELETE' }
    );

    return {
      anime_id: target.anime_id,
      title: target.title,
      media_type: 'series',
      scope: 'series',
      downloader: 'sonarr',
      server_name: match.server.name,
      managed_id: match.series.id,
      season_number: null,
      deleted_files: target.episode_count,
      unmonitored: false,
      jellyfin_paths: target.jellyfin_paths,
    };
  }

  const episodeFiles = normalizeArrList(await arrFetch(
    match.server,
    `/api/v3/episodefile?seriesId=${encodeURIComponent(match.series.id)}`
  ));
  const targetFiles = episodeFiles.filter(file => episodeFileMatchesTarget(file, target));

  if (targetFiles.length === 0) {
    throw new ServerRemovalError(
      `Found "${target.title}" in Sonarr, but no linked Season ${seasonNumber} episode files matched CultAnime.`,
      404
    );
  }

  const targetFileIds = new Set(targetFiles.map(file => String(file.id)));
  const remainingFiles = episodeFiles.filter(file => !targetFileIds.has(String(file.id)));
  const removeEmptySeries = boolFromEnv('SERVER_REMOVE_EMPTY_SONARR_SERIES', true);

  if (remainingFiles.length === 0 && removeEmptySeries) {
    await arrFetch(
      match.server,
      `/api/v3/series/${encodeURIComponent(match.series.id)}?deleteFiles=true&addImportListExclusion=false`,
      { method: 'DELETE' }
    );

    return {
      anime_id: target.anime_id,
      title: target.title,
      media_type: 'series',
      scope: 'series',
      downloader: 'sonarr',
      server_name: match.server.name,
      managed_id: match.series.id,
      season_number: seasonNumber,
      deleted_files: targetFiles.length,
      unmonitored: false,
      jellyfin_paths: target.jellyfin_paths,
    };
  }

  const unmonitored = await unmonitorSonarrSeason(match.server, match.series, seasonNumber);

  for (const file of targetFiles) {
    await deleteSonarrEpisodeFile(match.server, file);
  }

  return {
    anime_id: target.anime_id,
    title: target.title,
    media_type: 'series',
    scope: 'season',
    downloader: 'sonarr',
    server_name: match.server.name,
    managed_id: match.series.id,
    season_number: seasonNumber,
    deleted_files: targetFiles.length,
    unmonitored,
    jellyfin_paths: target.jellyfin_paths,
  };
}

export async function getServerRemovalPreview(animeId) {
  const target = await buildRemovalTarget(animeId);
  const downloader = target.media_type === 'movie' ? 'radarr' : 'sonarr';
  const servers = await managedServers(downloader);

  return {
    anime_id: target.anime_id,
    title: target.title,
    media_type: target.media_type,
    scope: target.media_type === 'movie'
      ? 'movie'
      : target.season_number ? 'season' : 'series',
    season_number: target.season_number,
    episode_count: target.episode_count,
    downloader,
    configured: servers.length > 0,
    server_count: servers.length,
    has_provider_id: Boolean(target.media_type === 'movie' ? target.tmdb_id : target.tvdb_id),
    has_file_paths: target.file_paths.length > 0,
  };
}

export async function removeAnimeFromServer(animeId) {
  const target = await buildRemovalTarget(animeId);

  if (target.media_type === 'movie') {
    return removeMovieFromServer(target);
  }

  return removeSeriesFromServer(target);
}
