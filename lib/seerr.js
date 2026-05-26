const DEFAULT_TIMEOUT_MS = 15000;
const ANIMATION_GENRE_ID = 16;
const DEFAULT_ANIME_COUNTRIES = ['JP'];
const DEFAULT_ANIME_LANGUAGES = ['ja'];
const DEFAULT_ANIME_MOVIE_ROOT_FOLDER = '/media/anime_movies';

export class SeerrApiError extends Error {
  constructor(message, status = 500, payload = null) {
    super(message);
    this.name = 'SeerrApiError';
    this.status = status;
    this.payload = payload;
  }
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function getSeerrConfig() {
  const baseUrl = normalizeBaseUrl(process.env.SEERR_URL || process.env.JELLYSEERR_URL || process.env.REQUEST_URL);
  const apiKey = String(process.env.SEERR_API_KEY || process.env.JELLYSEERR_API_KEY || process.env.OVERSEERR_API_KEY || '').trim();

  return {
    baseUrl,
    apiKey,
    configured: Boolean(baseUrl && apiKey),
    missing: {
      url: !baseUrl,
      apiKey: !apiKey,
    },
  };
}

async function readResponsePayload(res) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFromPayload(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.error === 'string') return payload.error;
  if (Array.isArray(payload.errors) && payload.errors[0]?.message) return payload.errors[0].message;
  return fallback;
}

export async function seerrFetch(path, options = {}) {
  const config = getSeerrConfig();

  if (!config.configured) {
    throw new SeerrApiError('Seerr is not configured. Set SEERR_URL and SEERR_API_KEY.', 503, config.missing);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'X-Api-Key': config.apiKey,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const payload = await readResponsePayload(res);

    if (!res.ok) {
      throw new SeerrApiError(
        messageFromPayload(payload, `Seerr API error (${res.status})`),
        res.status,
        payload
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof SeerrApiError) throw error;
    if (error.name === 'AbortError') {
      throw new SeerrApiError('Seerr took too long to respond.', 504);
    }
    throw new SeerrApiError(`Could not reach Seerr: ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeSeerrImage(path, size = 'w342') {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `https://image.tmdb.org/t/p/${size}${path.startsWith('/') ? path : `/${path}`}`;
}

function animeMovieRootFolder() {
  return String(process.env.SEERR_ANIME_MOVIE_ROOT_FOLDER || DEFAULT_ANIME_MOVIE_ROOT_FOLDER).trim();
}

function numberFromEnv(...names) {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isInteger(value) && value >= 0) return value;
  }

  return null;
}

function envList(name, fallback) {
  return String(process.env[name] || '')
    .split(',')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean)
    .concat(String(process.env[name] || '').trim() ? [] : fallback);
}

function collectGenreIds(item) {
  const ids = new Set();
  const add = value => {
    const id = Number(value);
    if (Number.isFinite(id)) ids.add(id);
  };

  (item.genreIds || item.genre_ids || []).forEach(add);
  (item.genres || []).forEach(genre => {
    if (typeof genre === 'number') add(genre);
    if (genre?.id !== undefined) add(genre.id);
  });

  return ids;
}

function collectCountries(item) {
  const values = [
    ...(item.originCountry || []),
    ...(item.origin_country || []),
    ...(item.productionCountries || []).map(country => country.iso_3166_1 || country.iso31661),
    ...(item.production_countries || []).map(country => country.iso_3166_1 || country.iso31661),
  ];

  return new Set(values.filter(Boolean).map(value => String(value).toUpperCase()));
}

function collectLanguages(item) {
  return new Set([
    item.originalLanguage,
    item.original_language,
  ].filter(Boolean).map(value => String(value).toLowerCase()));
}

export function isAnimeMediaItem(item) {
  const animeCountries = new Set(envList('SEERR_ANIME_ORIGIN_COUNTRIES', DEFAULT_ANIME_COUNTRIES));
  const animeLanguages = new Set(envList('SEERR_ANIME_LANGUAGES', DEFAULT_ANIME_LANGUAGES).map(value => value.toLowerCase()));
  const genreIds = collectGenreIds(item);
  const countries = collectCountries(item);
  const languages = collectLanguages(item);
  const hasAnimationGenre = genreIds.has(ANIMATION_GENRE_ID);
  const hasAnimeCountry = Array.from(countries).some(country => animeCountries.has(country));
  const hasAnimeLanguage = Array.from(languages).some(language => animeLanguages.has(language));

  return hasAnimationGenre && (hasAnimeCountry || hasAnimeLanguage);
}

export function isAnimeTvItem(item) {
  if (item.mediaType && item.mediaType !== 'tv') return false;
  return isAnimeMediaItem(item);
}

export function isAnimeMovieItem(item) {
  if (item.mediaType && item.mediaType !== 'movie') return false;
  return isAnimeMediaItem(item);
}

export function normalizeSeerrResult(item) {
  const title = item.name || item.title || item.originalName || item.originalTitle || 'Untitled';
  const firstAirDate = item.firstAirDate || item.first_air_date || item.releaseDate || item.release_date || null;
  const status = item.mediaInfo?.status ?? item.mediaInfo?.status4k ?? null;
  const mediaType = item.mediaType || (item.name || item.firstAirDate || item.first_air_date ? 'tv' : 'movie');

  return {
    id: item.id,
    mediaType,
    title,
    overview: item.overview || '',
    year: firstAirDate ? String(firstAirDate).slice(0, 4) : null,
    poster: normalizeSeerrImage(item.posterPath || item.poster_path),
    backdrop: normalizeSeerrImage(item.backdropPath || item.backdrop_path, 'w780'),
    voteAverage: item.voteAverage || item.vote_average || null,
    status,
    requestCount: item.mediaInfo?.requests?.length || 0,
    isAnime: mediaType === 'movie' ? isAnimeMovieItem({ ...item, mediaType }) : isAnimeTvItem({ ...item, mediaType }),
  };
}

function seasonStatusFromMediaInfo(mediaInfo, seasonNumber) {
  const seasons = mediaInfo?.seasons || [];
  return seasons.find(season => {
    const number = season.seasonNumber ?? season.season_number;
    return Number(number) === Number(seasonNumber);
  }) || null;
}

export function normalizeSeerrSeason(season, mediaInfo = null) {
  const seasonNumber = season.seasonNumber ?? season.season_number;
  const mediaSeason = seasonStatusFromMediaInfo(mediaInfo, seasonNumber);
  const episodeCount = season.episodeCount ?? season.episode_count ?? null;
  const airDate = season.airDate || season.air_date || null;
  const name = season.name || (Number(seasonNumber) === 0 ? 'Specials' : `Season ${seasonNumber}`);

  return {
    id: season.id || null,
    seasonNumber: Number(seasonNumber),
    name,
    overview: season.overview || '',
    airDate,
    year: airDate ? String(airDate).slice(0, 4) : null,
    episodeCount,
    poster: normalizeSeerrImage(season.posterPath || season.poster_path),
    status: mediaSeason?.status ?? mediaSeason?.status4k ?? season.status ?? null,
  };
}

export function normalizeSeerrTvDetails(item) {
  const title = item.name || item.title || item.originalName || item.originalTitle || 'Untitled';
  const seasons = (item.seasons || [])
    .map(season => normalizeSeerrSeason(season, item.mediaInfo || item.media_info))
    .filter(season => Number.isFinite(season.seasonNumber))
    .sort((a, b) => a.seasonNumber - b.seasonNumber);

  return {
    id: item.id,
    title,
    overview: item.overview || '',
    isAnime: isAnimeTvItem({ ...item, mediaType: 'tv' }),
    seasons,
  };
}

export function normalizeSeerrMovieDetails(item) {
  const title = item.title || item.name || item.originalTitle || item.originalName || 'Untitled';
  const releaseDate = item.releaseDate || item.release_date || null;

  return {
    id: item.id,
    title,
    overview: item.overview || '',
    year: releaseDate ? String(releaseDate).slice(0, 4) : null,
    isAnime: isAnimeMovieItem({ ...item, mediaType: 'movie' }),
  };
}

export async function searchSeerrTv(query, page = 1) {
  const data = await searchSeerrAnime(query, page);
  return {
    ...data,
    results: data.results.filter(item => item.mediaType === 'tv'),
  };
}

export async function searchSeerrAnime(query, page = 1) {
  const params = [
    `query=${encodeURIComponent(query)}`,
    `page=${encodeURIComponent(String(page))}`,
    'language=en',
  ].join('&');
  const data = await seerrFetch(`/api/v1/search?${params}`);
  const results = (data?.results || [])
    .filter(item => (
      (item.mediaType === 'tv' && isAnimeTvItem(item)) ||
      (item.mediaType === 'movie' && isAnimeMovieItem(item))
    ))
    .map(normalizeSeerrResult);

  return {
    page: data?.page || page,
    totalPages: data?.totalPages || 1,
    totalResults: data?.totalResults || results.length,
    results,
  };
}

export async function getSeerrTvDetails(mediaId) {
  const path = `/api/v1/tv/${encodeURIComponent(String(mediaId))}?language=en`;
  return normalizeSeerrTvDetails(await seerrFetch(path));
}

export async function getSeerrMovieDetails(mediaId) {
  const path = `/api/v1/movie/${encodeURIComponent(String(mediaId))}?language=en`;
  return normalizeSeerrMovieDetails(await seerrFetch(path));
}

export async function getSeerrAnimeTvDetails(mediaId) {
  const details = await getSeerrTvDetails(mediaId);

  if (!details.isAnime) {
    throw new SeerrApiError('This title does not look like anime, so CultAnime will not request it.', 400);
  }

  return details;
}

export async function getSeerrAnimeMovieDetails(mediaId) {
  const details = await getSeerrMovieDetails(mediaId);

  if (!details.isAnime) {
    throw new SeerrApiError('This movie does not look like anime, so CultAnime will not request it.', 400);
  }

  return details;
}

export async function requestSeerrTv(mediaId, seasons = 'all') {
  const body = {
    mediaType: 'tv',
    mediaId,
  };

  if (Array.isArray(seasons) && seasons.length > 0) {
    body.seasons = seasons;
  }

  return seerrFetch('/api/v1/request', {
    method: 'POST',
    body,
  });
}

export async function requestSeerrMovie(mediaId) {
  const rootFolder = animeMovieRootFolder();
  const serverId = numberFromEnv('SEERR_ANIME_MOVIE_RADARR_SERVER_ID', 'SEERR_MOVIE_RADARR_SERVER_ID');
  const profileId = numberFromEnv('SEERR_ANIME_MOVIE_PROFILE_ID', 'SEERR_MOVIE_PROFILE_ID');
  const body = {
    mediaType: 'movie',
    mediaId,
    ...(serverId !== null ? { serverId } : {}),
    ...(profileId !== null ? { profileId } : {}),
    ...(rootFolder ? { rootFolder } : {}),
  };

  return seerrFetch('/api/v1/request', {
    method: 'POST',
    body,
  });
}
