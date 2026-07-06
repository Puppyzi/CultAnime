const ANILIST_API = 'https://graphql.anilist.co';
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const SEASON_START_MONTHS = {
  WINTER: 1,
  SPRING: 4,
  SUMMER: 7,
  FALL: 10,
};
const AIRING_MEDIA_SELECTION = `
  id
  title {
    romaji
    english
    native
  }
  description(asHtml: false)
  coverImage {
    extraLarge
    large
    medium
    color
  }
  bannerImage
  genres
  status
  episodes
  averageScore
  popularity
  seasonYear
  season
  format
  startDate {
    year
    month
    day
  }
  endDate {
    year
    month
    day
  }
  nextAiringEpisode {
    airingAt
    timeUntilAiring
    episode
  }
  studios(isMain: true) {
    nodes {
      name
    }
  }
`;
const AIRING_CATEGORIES = [
  { key: 'tv', label: 'TV', formats: ['TV'], leftover: false },
  { key: 'tv-short', label: 'TV Short', formats: ['TV_SHORT'], leftover: false },
  { key: 'movie', label: 'Movie', formats: ['MOVIE'], leftover: false },
  { key: 'leftover', label: 'Leftover', formats: ['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL'], leftover: true },
  { key: 'ova-ona-special', label: 'OVA / ONA / Special', formats: ['OVA', 'ONA', 'SPECIAL'], leftover: false },
];
const NEXT_AIRING_CACHE_MS = 15 * 60 * 1000;
const NEXT_AIRING_TIMEOUT_MS = 5000;
const nextAiringCache = new Map();
const ANILIST_RETRYABLE_STATUS = new Set([429, 500, 502, 503]);
const ANILIST_RETRY_FALLBACK_MS = 2000;
const ANILIST_RETRY_MAX_WAIT_MS = 10000;

async function anilistRequest(graphqlQuery, variables, label = 'AniList request') {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables }),
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON body (e.g. a gateway error page) - handled as a failure below.
    }

    if (response.ok && !data?.errors?.length && data?.data) {
      return data.data;
    }

    if (attempt === 0 && ANILIST_RETRYABLE_STATUS.has(response.status)) {
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : ANILIST_RETRY_FALLBACK_MS;

      // When AniList asks for a longer cooldown than we can afford to block,
      // fail now and let the caller's own retry cadence handle it.
      if (waitMs <= ANILIST_RETRY_MAX_WAIT_MS) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
    }

    throw new Error(data?.errors?.[0]?.message || `${label} failed (HTTP ${response.status}).`);
  }
}

function stripHtml(value) {
  return value ? value.replace(/<[^>]*>/g, '') : '';
}

export function currentAnilistSeason(date = new Date()) {
  const month = date.getMonth();
  const season = SEASONS[Math.floor(month / 3)] || 'WINTER';

  return {
    season,
    year: date.getFullYear(),
  };
}

function seasonStartDateInt(season, year) {
  const month = SEASON_START_MONTHS[season] || 1;
  return (Number(year) * 10000) + (month * 100) + 1;
}

function normalizeAiringCategory(categoryKey) {
  return AIRING_CATEGORIES.find(category => category.key === categoryKey) || null;
}

function mediaDateFor(date) {
  date = date || {};
  if (!date.year || !date.month || !date.day) return null;
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function startDateFor(media) {
  return mediaDateFor(media.startDate);
}

function endDateFor(media) {
  return mediaDateFor(media.endDate);
}

export async function searchAnilist(query, page = 1, perPage = 20, seasonYear = null) {
  const yearFilter = Number.isInteger(Number(seasonYear)) && Number(seasonYear) > 0;
  const graphqlQuery = `
    query ($search: String, $page: Int, $perPage: Int${yearFilter ? ', $seasonYear: Int' : ''}) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
        }
        media(search: $search, type: ANIME, sort: POPULARITY_DESC${yearFilter ? ', seasonYear: $seasonYear' : ''}) {
          id
          title {
            romaji
            english
            native
          }
          synonyms
          description(asHtml: false)
          coverImage {
            extraLarge
            large
            medium
          }
          bannerImage
          genres
          status
          episodes
          averageScore
          seasonYear
          season
          format
          studios(isMain: true) {
            nodes {
              name
            }
          }
        }
      }
    }
  `;

  const data = await anilistRequest(graphqlQuery, {
    search: query,
    page,
    perPage,
    ...(yearFilter ? { seasonYear: Number(seasonYear) } : {}),
  }, 'AniList search');

  return data.Page;
}

export async function getAnilistAnime(anilistId) {
  const graphqlQuery = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title {
          romaji
          english
          native
        }
        synonyms
        description(asHtml: false)
        coverImage {
          extraLarge
          large
          medium
        }
        bannerImage
        genres
        status
        episodes
        averageScore
        seasonYear
        season
        format
        studios(isMain: true) {
          nodes {
            name
          }
        }
        relations {
          edges {
            relationType
            node {
              id
              title {
                romaji
                english
              }
              coverImage {
                large
              }
              format
              status
              episodes
            }
          }
        }
        recommendations(sort: RATING_DESC, perPage: 6) {
          nodes {
            mediaRecommendation {
              id
              title {
                romaji
                english
              }
              coverImage {
                large
              }
              format
              episodes
              averageScore
            }
          }
        }
      }
    }
  `;

  const data = await anilistRequest(graphqlQuery, { id: anilistId }, 'AniList lookup');
  return data.Media;
}

export async function getNextAiringEpisode(anilistId) {
  const id = Number(anilistId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const cached = nextAiringCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const graphqlQuery = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        nextAiringEpisode {
          airingAt
          timeUntilAiring
          episode
        }
      }
    }
  `;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEXT_AIRING_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { id },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AniList next airing lookup timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json();
  if (!response.ok || data.errors?.length) {
    throw new Error(data.errors?.[0]?.message || 'AniList next airing lookup failed.');
  }

  const value = data.data?.Media?.nextAiringEpisode || null;
  nextAiringCache.set(id, {
    value,
    expiresAt: Date.now() + NEXT_AIRING_CACHE_MS,
  });

  return value;
}

async function fetchAiringCategory({ category, season, year, page, perPage }) {
  const resolvedPage = Math.max(1, Number(page) || 1);
  const resolvedPerPage = Math.min(50, Math.max(1, Number(perPage) || 50));
  const graphqlQuery = category.leftover ? `
    query ($seasonStart: FuzzyDateInt, $formats: [MediaFormat], $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
        }
        media(
          type: ANIME,
          status: RELEASING,
          isAdult: false,
          startDate_lesser: $seasonStart,
          format_in: $formats,
          sort: POPULARITY_DESC
        ) {
          ${AIRING_MEDIA_SELECTION}
        }
      }
    }
  ` : `
    query ($season: MediaSeason, $seasonYear: Int, $formats: [MediaFormat], $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
        }
        media(
          type: ANIME,
          season: $season,
          seasonYear: $seasonYear,
          status_in: [RELEASING, FINISHED, NOT_YET_RELEASED],
          isAdult: false,
          format_in: $formats,
          sort: POPULARITY_DESC
        ) {
          ${AIRING_MEDIA_SELECTION}
        }
      }
    }
  `;

  const variables = category.leftover
    ? {
      seasonStart: seasonStartDateInt(season, year),
      formats: category.formats,
      page: resolvedPage,
      perPage: resolvedPerPage,
    }
    : {
      season,
      seasonYear: year,
      formats: category.formats,
      page: resolvedPage,
      perPage: resolvedPerPage,
    };

  const data = await anilistRequest(graphqlQuery, variables, 'AniList seasonal lookup');
  const pageData = data.Page;

  return {
    key: category.key,
    label: category.label,
    pageInfo: pageData.pageInfo,
    anime: pageData.media.map(media => ({
      ...formatAiringAnime(media),
      airing_category: category.key,
    })),
  };
}

export async function getAiringAnime({ season, year, page = 1, perPage = 50, category: categoryKey = null } = {}) {
  const current = currentAnilistSeason();
  const resolvedSeason = season || current.season;
  const resolvedYear = Number(year) || current.year;

  if (categoryKey) {
    const category = normalizeAiringCategory(categoryKey);
    if (!category) throw new Error('Unknown airing category.');

    const group = await fetchAiringCategory({
      category,
      season: resolvedSeason,
      year: resolvedYear,
      page,
      perPage,
    });

    return {
      season: resolvedSeason,
      year: resolvedYear,
      category: group,
      pageInfo: group.pageInfo,
      anime: group.anime,
    };
  }

  const groups = await Promise.all(AIRING_CATEGORIES.map(category => fetchAiringCategory({
    category,
    season: resolvedSeason,
    year: resolvedYear,
    page: 1,
    perPage,
  })));

  return {
    season: resolvedSeason,
    year: resolvedYear,
    groups,
    pageInfo: null,
    anime: groups.flatMap(group => group.anime),
  };
}

export function formatAiringAnime(media) {
  return {
    anilist_id: media.id,
    title: media.title.english || media.title.romaji,
    title_romaji: media.title.romaji,
    title_english: media.title.english,
    title_native: media.title.native,
    request_title: media.title.romaji || media.title.english,
    description: stripHtml(media.description),
    cover_image: media.coverImage.extraLarge || media.coverImage.large || media.coverImage.medium,
    cover_color: media.coverImage.color,
    banner_image: media.bannerImage,
    genres: media.genres || [],
    status: media.status,
    episodes_total: media.episodes,
    rating: media.averageScore,
    popularity: media.popularity,
    year: media.seasonYear,
    season: media.season,
    format: media.format,
    start_date: startDateFor(media),
    end_date: endDateFor(media),
    studios: media.studios?.nodes?.map(s => s.name) || [],
    next_airing_episode: media.nextAiringEpisode || null,
  };
}

export function formatAnilistData(media) {
  return {
    anilist_id: media.id,
    title: media.title.english || media.title.romaji,
    title_romaji: media.title.romaji,
    title_english: media.title.english,
    description: stripHtml(media.description),
    cover_image: media.coverImage.extraLarge || media.coverImage.large,
    banner_image: media.bannerImage,
    genres: JSON.stringify(media.genres || []),
    status: media.status,
    episodes_total: media.episodes,
    rating: media.averageScore,
    year: media.seasonYear,
    season: media.season,
    format: media.format,
    studios: JSON.stringify(media.studios?.nodes?.map(s => s.name) || []),
  };
}
