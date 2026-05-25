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
  seasonYear
  season
  format
  startDate {
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

function startDateFor(media) {
  const date = media.startDate || {};
  if (!date.year || !date.month || !date.day) return null;
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export async function searchAnilist(query, page = 1, perPage = 20) {
  const graphqlQuery = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
        }
        media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
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

  const response = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: graphqlQuery,
      variables: { search: query, page, perPage },
    }),
  });

  const data = await response.json();
  return data.data.Page;
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

  const response = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: graphqlQuery,
      variables: { id: anilistId },
    }),
  });

  const data = await response.json();
  return data.data.Media;
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

  const response = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: graphqlQuery,
      variables,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.errors?.length) {
    throw new Error(data.errors?.[0]?.message || 'AniList seasonal lookup failed.');
  }

  const pageData = data.data.Page;

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
    year: media.seasonYear,
    season: media.season,
    format: media.format,
    start_date: startDateFor(media),
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
