// Group presentation only: season IDs, episodes, history and downloads stay intact.
const SEASON_ORDER = { WINTER: 1, SPRING: 2, SUMMER: 3, FALL: 4 };

export function jsonList(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function seasonMarker(title = '') {
  title = String(title || '');
  return title.match(/\bseason\s+(\d+)\b/i)?.[1] || title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i)?.[1];
}

function baseTitle(title = '') {
  return title.replace(/\s+(?:season\s+\d+|\d+(?:st|nd|rd|th)\s+season)(?:\s+part\s+\d+)?\s*$/i, '').trim();
}

function normalizedTitle(title) {
  return baseTitle(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function sourceSeason(anime) {
  const match = String(anime.jellyfin_id || '').match(/^(.*):season:(\d+)$/);
  return {
    parent: match?.[1] || null,
    number: match
      ? Number(match[2])
      : Number(seasonMarker(anime.title) || seasonMarker(anime.title_romaji)) ||
        Number(anime.season_number) ||
        null,
  };
}

function compareSeasons(a, b, numbered) {
  const left = sourceSeason(a),
    right = sourceSeason(b);
  if (numbered && left.number !== right.number) return (left.number ?? 0) - (right.number ?? 0);
  return (
    (Number(a.year) || 0) - (Number(b.year) || 0) ||
    (SEASON_ORDER[a.season] || 0) - (SEASON_ORDER[b.season] || 0) ||
    Number(a.id) - Number(b.id)
  );
}

export function groupAnimeSeries(rows) {
  const parents = new Map();
  function find(key) {
    if (!parents.has(key)) parents.set(key, key);
    if (parents.get(key) !== key) parents.set(key, find(parents.get(key)));
    return parents.get(key);
  }
  function join(a, b) {
    parents.set(find(a), find(b));
  }
  const titles = new Map();
  for (const row of rows) {
    const key = 'local:' + row.id;
    find(key);
    const source = sourceSeason(row);
    if (source.parent) join(key, 'jellyfin:' + source.parent);
    if (row.anilist_id) {
      join(key, 'anilist:' + row.anilist_id);
      for (const relation of jsonList(row.series_relations)) {
        if (['PREQUEL', 'SEQUEL'].includes(relation?.type) && relation.id) join(key, 'anilist:' + relation.id);
      }
    }
    // Conservative fallback for manual imports with explicit numbered titles.
    // Jellyfin's own grouping takes precedence over title guesses.
    if (!row.jellyfin_id && row.format !== 'MOVIE') {
      for (const title of [row.title, row.title_english, row.title_romaji].filter(Boolean)) {
        const normalized = normalizedTitle(title);
        const previous = titles.get(normalized);
        if (previous && (seasonMarker(title) || previous.numbered)) join(key, previous.key);
        if (!previous || seasonMarker(title))
          titles.set(normalized, { key, numbered: Boolean(seasonMarker(title)) });
      }
    }
  }
  const groups = new Map();
  for (const row of rows) {
    // Metadata-only entries can connect a franchise, but aren't selectable.
    if (!(Number(row.episode_count) > 0)) continue;
    const key = find('local:' + row.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, genres: jsonList(row.genres), studios: jsonList(row.studios) });
  }
  return [...groups.values()].map((members) => {
    const parent = sourceSeason(members[0]).parent;
    const numbered =
      members.every((member) => sourceSeason(member).number != null) &&
      (members.every((member) => parent && sourceSeason(member).parent === parent) ||
        members.every((member) => normalizedTitle(member.title) === normalizedTitle(members[0].title)));
    members.sort((a, b) => compareSeasons(a, b, numbered));
    const first = members[0];
    const latest = members[members.length - 1];
    const commonTitle = members.every(
      (member) => normalizedTitle(member.title) === normalizedTitle(first.title)
    );
    const labels = members.map((member) => {
      const number = sourceSeason(member).number;
      return commonTitle && number != null && member.format !== 'MOVIE'
        ? number === 0
          ? 'Specials'
          : 'Season ' + number
        : member.title;
    });
    const seasons = members.map((member, index) => ({
      ...member,
      // Separate cours sharing a season number retain their distinct titles.
      season_label:
        labels.filter((label) => label === labels[index]).length > 1 ? member.title : labels[index],
    }));
    return {
      ...latest,
      id: first.id,
      title: commonTitle ? baseTitle(first.title) : first.title,
      series_id: first.id,
      season_ids: seasons.map((member) => member.id),
      season_count: seasons.length,
      latest_season_id: latest.id,
      latest_episode_count: latest.episode_count,
      latest_episodes_total: latest.episodes_total,
      episode_count: seasons.reduce((sum, member) => sum + Number(member.episode_count), 0),
      episodes_total: seasons.reduce(
        (sum, member) => sum + Math.max(Number(member.episodes_total) || 0, Number(member.episode_count)),
        0
      ),
      first_episode_number: first.first_episode_number || 1,
      genres: [...new Set(seasons.flatMap((member) => member.genres))],
      created_at: seasons
        .map((member) => member.created_at || '')
        .sort()
        .at(-1),
      seasons,
    };
  });
}

export function queryAnimeSeries(
  rows,
  { search = '', genre = '', sort = 'created_at', order = 'DESC', page = 1, limit = 20 } = {}
) {
  const term = search.trim().toLowerCase();
  const matches = groupAnimeSeries(rows).filter(
    (series) =>
      (!genre || series.genres.includes(genre)) &&
      (!term ||
        series.seasons.some((member) =>
          [member.title, member.title_romaji, member.title_english].some((title) =>
            title?.toLowerCase().includes(term)
          )
        ))
  );
  const column = ['title', 'rating', 'year', 'created_at'].includes(sort) ? sort : 'created_at';
  const direction = order === 'ASC' ? 1 : -1;
  matches.sort((a, b) => {
    const comparison = ['rating', 'year'].includes(column)
      ? (Number(a[column]) || 0) - (Number(b[column]) || 0)
      : String(a[column] || '').localeCompare(String(b[column] || ''), undefined, { sensitivity: 'base' });
    return direction * (comparison || a.id - b.id);
  });
  return {
    anime: matches
      .slice((page - 1) * limit, page * limit)
      .map(({ seasons: _seasons, series_relations: _relations, ...card }) => card),
    total: matches.length,
    page,
    totalPages: Math.ceil(matches.length / limit),
  };
}

export function readAnimeSeriesRows(db) {
  return db
    .prepare(
      'SELECT anime.*, COUNT(e.id) AS episode_count, MIN(e.episode_number) AS first_episode_number, MIN(e.season_number) AS season_number FROM anime LEFT JOIN episodes e ON e.anime_id = anime.id GROUP BY anime.id'
    )
    .all();
}
