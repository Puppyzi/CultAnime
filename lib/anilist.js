const ANILIST_API = 'https://graphql.anilist.co';

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

export function formatAnilistData(media) {
  return {
    anilist_id: media.id,
    title: media.title.english || media.title.romaji,
    title_romaji: media.title.romaji,
    title_english: media.title.english,
    description: media.description ? media.description.replace(/<[^>]*>/g, '') : '',
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
