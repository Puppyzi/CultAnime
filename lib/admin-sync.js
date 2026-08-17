import { getDb } from './db';
import { searchAnilist, getAnilistAnime, formatAnilistData } from './anilist';
import { getEpisodeAirDateOverride } from './episode-overrides';
import { episodeOverviewTrust } from './episode-overview-trust';
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

function ordinalNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);

  const rounded = Math.trunc(number);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;

  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}

function cleanSeriesNameForSearch(value) {
  return String(value || '')
    .replace(/\(\d{4}\)/g, ' ')
    .replace(/\{[^}]*}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTextForMedia(media) {
  return [
    media?.title?.romaji,
    media?.title?.english,
    media?.title?.native,
  ].filter(Boolean).join(' ').toLowerCase();
}

function titleTextForAnimeRecord(record) {
  return [
    record?.title,
    record?.title_romaji,
    record?.title_english,
  ].filter(Boolean).join(' ').toLowerCase();
}

function seasonSearchQueries(itemName, seasonNumber) {
  const baseName = cleanSeriesNameForSearch(itemName);
  const season = Number(seasonNumber);

  if (!baseName) return [];
  if (!Number.isFinite(season) || season <= 1) return [baseName];

  return [
    `${baseName} ${ordinalNumber(season)} Season`,
    `${baseName} Season ${season}`,
    baseName,
  ];
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function mostCommonNumber(values) {
  const counts = new Map();

  for (const value of values) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    counts.set(number, (counts.get(number) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0]?.[0] || null;
}

function yearFromEpisode(ep) {
  const productionYear = Number(ep?.ProductionYear);
  if (Number.isFinite(productionYear) && productionYear > 0) return productionYear;

  const airDate = normalizeAirDate(ep?.PremiereDate);
  return airDate ? Number(airDate.slice(0, 4)) : null;
}

function syncContextForEpisodeItems(episodeItems = []) {
  const seasonNumbers = episodeItems
    .map(ep => Number(ep?.ParentIndexNumber))
    .filter(number => Number.isFinite(number) && number > 0);
  const uniqueSeasonNumbers = [...new Set(seasonNumbers)];
  const episodeNumbers = episodeItems
    .map(ep => Number(ep?.IndexNumber))
    .filter(number => Number.isFinite(number) && number > 0);

  return {
    seasonNumber: uniqueSeasonNumbers.length === 1 ? uniqueSeasonNumbers[0] : null,
    maxEpisodeNumber: episodeNumbers.length > 0 ? Math.max(...episodeNumbers) : null,
    productionYear: mostCommonNumber(episodeItems.map(yearFromEpisode)),
  };
}

function seasonNumberFromEpisode(ep) {
  const seasonNumber = Number(ep?.ParentIndexNumber);
  return Number.isFinite(seasonNumber) && seasonNumber > 0 ? seasonNumber : null;
}

function syncGroupsForSeriesEpisodes(episodeItems = []) {
  const groups = new Map();

  for (const episode of episodeItems) {
    const seasonNumber = seasonNumberFromEpisode(episode);
    const key = seasonNumber ? `season:${seasonNumber}` : 'series';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(episode);
  }

  return [...groups.values()].map(items => ({
    episodeItems: items,
    syncContext: syncContextForEpisodeItems(items),
  }));
}

function syncJellyfinIdForItem(item, kind = itemKind(item), syncContext = {}) {
  const seasonNumber = Number(syncContext.seasonNumber);
  if (kind === 'series' && Number.isFinite(seasonNumber) && seasonNumber > 0) {
    return `${item.Id}:season:${seasonNumber}`;
  }

  return item.Id;
}

function syncNameForItem(item, kind = itemKind(item), syncContext = {}) {
  const seasonNumber = Number(syncContext.seasonNumber);
  if (kind === 'series' && Number.isFinite(seasonNumber) && seasonNumber > 0) {
    return `${item.Name} - Season ${seasonNumber}`;
  }

  return item.Name;
}

function existingAnimeMatchesSeason(anime, syncContext = {}) {
  const seasonNumber = Number(syncContext.seasonNumber);
  if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) return true;

  const titleText = titleTextForAnimeRecord(anime);
  if (seasonNumber > 1) {
    return seasonMarkerMatches(titleText, seasonNumber);
  }

  if (seasonMarkerMatches(titleText, 2) || /\b(?:2nd|3rd|4th|5th|season\s+[2-9])\b/i.test(titleText)) {
    return false;
  }

  return !syncContext.productionYear || !anime?.year || Number(anime.year) === Number(syncContext.productionYear);
}

const WORD_ORDINALS = {
  2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth',
  6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth',
};

function seasonMarkerMatches(text, seasonNumber) {
  const season = Number(seasonNumber);
  if (!Number.isFinite(season) || season <= 1) return false;

  const ordinal = ordinalNumber(season).toLowerCase();
  const wordOrdinal = WORD_ORDINALS[season];
  return text.includes(`${ordinal} season`)
    || text.includes(`season ${season}`)
    || (wordOrdinal ? text.includes(`${wordOrdinal} season`) : false)
    || new RegExp(`\\b${season}(?:st|nd|rd|th)\\s+season\\b`, 'i').test(text);
}

const SEASON_MARKER_STRIP_PATTERNS = [
  /\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final)\s+season\b/g,
  /\bseason\s+\d{1,2}\b/g,
  /\b(?:part|cour)\s+\d{1,2}\b/g,
  /\s+(?:ii|iii|iv|vi|vii|viii|ix)$/,
  /\s+\d{1,2}$/,
];

function normalizeTitleForSimilarity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSeasonMarkers(text) {
  let result = text;
  for (const pattern of SEASON_MARKER_STRIP_PATTERNS) {
    result = result.replace(pattern, ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);

  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }

  return previous[right.length];
}

function titleSimilarity(base, candidate) {
  if (!base || !candidate) return 0;
  if (base === candidate) return 1;

  const distance = levenshteinDistance(base, candidate);
  let similarity = 1 - distance / Math.max(base.length, candidate.length);

  // A candidate that starts with the base name as a whole word is a strong
  // franchise signal even when the full title is much longer.
  if (candidate.startsWith(`${base} `) || base.startsWith(`${candidate} `)) {
    similarity = Math.max(similarity, 0.6);
  }

  return similarity;
}

function bestTitleSimilarity(baseName, media) {
  const base = stripSeasonMarkers(normalizeTitleForSimilarity(baseName));
  if (!base) return 1;

  const titles = [
    media?.title?.romaji,
    media?.title?.english,
    media?.title?.native,
    ...(Array.isArray(media?.synonyms) ? media.synonyms : []),
  ];

  let best = 0;
  for (const title of titles) {
    const candidate = stripSeasonMarkers(normalizeTitleForSimilarity(title));
    if (!candidate) continue;
    best = Math.max(best, titleSimilarity(base, candidate));
    if (best >= 1) break;
  }

  return best;
}

const MIN_TITLE_SIMILARITY = 0.3;
const FRANCHISE_RELATION_TYPES = new Set(['SEQUEL', 'PREQUEL']);
const FRANCHISE_WALK_MAX_FETCHES = 8;

// AniList text search tokenizes titles, so a base name like "Monogatari"
// never matches compound named seasons such as "Nisemonogatari". Walking
// SEQUEL/PREQUEL relations from the base-name matches finds them.
async function franchiseRelationCandidates(anchorIds, productionYear, maxFetches = FRANCHISE_WALK_MAX_FETCHES) {
  const seen = new Set(anchorIds);
  const queue = [...anchorIds];
  const collected = [];
  let fetches = 0;

  while (queue.length > 0 && fetches < maxFetches) {
    const id = queue.shift();
    fetches += 1;

    let media = null;
    try {
      media = await getAnilistAnime(id);
    } catch {
      continue;
    }
    if (!media?.id) continue;
    collected.push(media);

    const mediaYear = Number(media.seasonYear);
    for (const edge of media.relations?.edges || []) {
      if (!FRANCHISE_RELATION_TYPES.has(edge?.relationType)) continue;
      const node = edge?.node;
      if (!node?.id || seen.has(node.id)) continue;

      const nodeFormat = String(node.format || '').toUpperCase();
      if (nodeFormat === 'MOVIE' || nodeFormat === 'MUSIC') continue;

      // Only walk toward the target air year: sequels move forward in
      // time, prequels backward, so the other direction is a dead end.
      if (Number(productionYear) > 0 && mediaYear > 0) {
        if (edge.relationType === 'SEQUEL' && mediaYear > productionYear) continue;
        if (edge.relationType === 'PREQUEL' && mediaYear < productionYear) continue;
      }

      seen.add(node.id);
      queue.push(node.id);
    }
  }

  return collected;
}

function scoreAnilistCandidate(media, kind, syncContext = {}) {
  const format = String(media?.format || '').toUpperCase();

  // Never accept a candidate whose name does not resemble the series name;
  // AniList fuzzy search returns entries that merely share a word.
  const similarity = bestTitleSimilarity(syncContext.baseName, media);
  if (similarity < MIN_TITLE_SIMILARITY) return -1000;
  const similarityScore = Math.round(similarity * 40);

  if (kind === 'movie') {
    return (format === 'MOVIE' ? 30 : 0) + similarityScore;
  }

  if (format === 'MOVIE') return -1000;
  let score = 10 + similarityScore;

  const seasonNumber = Number(syncContext.seasonNumber);
  if (Number.isFinite(seasonNumber) && seasonNumber > 1) {
    const titleText = titleTextForMedia(media);
    if (seasonMarkerMatches(titleText, seasonNumber)) score += 25;

    // Episode air year is the most reliable discriminator between franchise
    // entries (named seasons often carry no "Season N" marker at all).
    const productionYear = Number(syncContext.productionYear);
    const candidateYear = Number(media?.seasonYear);
    if (productionYear > 0 && candidateYear > 0) {
      const yearDiff = Math.abs(candidateYear - productionYear);
      if (yearDiff === 0) {
        score += 60;
      } else if (yearDiff === 1) {
        score += 20;
      } else {
        score -= 40 * Math.min(yearDiff, 4);
      }
    }

    if (syncContext.maxEpisodeNumber && media?.episodes) {
      if (Number(media.episodes) >= Number(syncContext.maxEpisodeNumber)) {
        score += 10;
      } else {
        score -= 100;
      }
    }
  }

  return score;
}

function bestAnilistCandidate(candidates, kind, syncContext = {}) {
  const scored = uniqueById(candidates)
    .map((media, index) => ({
      media,
      score: scoreAnilistCandidate(media, kind, syncContext),
      index,
    }))
    .filter(candidate => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return scored[0]?.media || null;
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

function makePreviewItem(db, item, syncContext = {}) {
  const kind = itemKind(item);
  const syncJellyfinId = syncJellyfinIdForItem(item, kind, syncContext);
  const existing = findExistingAnime(db, item, kind, syncContext);

  return {
    jellyfin_id: syncJellyfinId,
    source_jellyfin_id: item.Id,
    season_number: syncContext.seasonNumber || null,
    name: syncNameForItem(item, kind, syncContext),
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

async function anilistDataForItem(item, kind, syncContext = {}) {
  const baseName = cleanSeriesNameForSearch(item.Name) || item.Name;
  const queries = kind === 'movie'
    ? [baseName]
    : seasonSearchQueries(item.Name, syncContext.seasonNumber);
  const candidates = [];

  for (const query of queries) {
    const anilistPage = await searchAnilist(query, 1, 10);
    candidates.push(...(anilistPage?.media || []));
  }

  // Named seasons (Shippuden-style titles) rarely rank for
  // "<series> Season N" searches; a year-filtered search surfaces the
  // franchise entry that actually aired when these episodes did.
  const productionYear = Number(syncContext.productionYear);
  if (kind !== 'movie' && Number(syncContext.seasonNumber) > 1 && productionYear > 0) {
    const yearPage = await searchAnilist(baseName, 1, 10, productionYear);
    candidates.push(...(yearPage?.media || []));
  }

  const matchContext = { ...syncContext, baseName };
  let bestMatch = bestAnilistCandidate(candidates, kind, matchContext);

  if (kind !== 'movie' && Number(syncContext.seasonNumber) > 1 && productionYear > 0) {
    const bestYear = Number(bestMatch?.seasonYear);
    const yearConfirmed = bestYear > 0 && Math.abs(bestYear - productionYear) <= 1;

    if (!yearConfirmed) {
      const anchorIds = uniqueById(candidates)
        .filter(media => String(media?.format || '').toUpperCase() !== 'MOVIE')
        .map(media => ({ id: media.id, similarity: bestTitleSimilarity(baseName, media) }))
        .filter(anchor => anchor.similarity >= MIN_TITLE_SIMILARITY)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 2)
        .map(anchor => anchor.id);

      if (anchorIds.length > 0) {
        const related = await franchiseRelationCandidates(anchorIds, productionYear);
        bestMatch = bestAnilistCandidate([...candidates, ...related], kind, matchContext);
      }
    }
  }

  if (!bestMatch) return null;

  const fullMedia = await getAnilistAnime(bestMatch.id);
  const animeData = formatAnilistData(fullMedia);

  if (kind === 'movie') {
    animeData.format = 'MOVIE';
    animeData.episodes_total = animeData.episodes_total || 1;
  }

  return animeData;
}

const MISSING_METADATA_RETRY_MS = 15 * 60 * 1000;
const missingMetadataNextRetryAt = new Map();

// The fallback record saved when an AniList lookup fails carries neither an
// AniList id nor a cover image; it renders broken and its year always agrees
// with its own episodes, so no other refresh trigger ever fires for it.
function animeMetadataMissing(record) {
  return !record?.anilist_id && !String(record?.cover_image || '').trim();
}

// The reconciler re-syncs every minute; without a cooldown, an anime that
// genuinely has no AniList entry would re-run the search on every pass.
function missingMetadataRetryReady(animeId) {
  const nextRetryAt = missingMetadataNextRetryAt.get(animeId) || 0;
  if (Date.now() < nextRetryAt) return false;
  missingMetadataNextRetryAt.set(animeId, Date.now() + MISSING_METADATA_RETRY_MS);
  return true;
}

// An anime added early in its season can predate AniList publishing an
// average score, and nothing else ever re-asks for it. Once the record has a
// confirmed AniList id, keep re-checking (on the shared cooldown) until a
// rating shows up.
function shouldRefreshMissingRating(record) {
  if (!record?.anilist_id) return false;
  if (record.rating !== null && record.rating !== undefined) return false;
  return missingMetadataRetryReady(record.id);
}

function shouldRefreshExistingAnimeMetadata(existingRecord, syncContext = {}) {
  if (animeMetadataMissing(existingRecord)) {
    return missingMetadataRetryReady(existingRecord.id);
  }

  const seasonNumber = Number(syncContext.seasonNumber);
  if (!Number.isFinite(seasonNumber) || seasonNumber <= 1) return false;

  const productionYear = Number(syncContext.productionYear);
  const recordYear = Number(existingRecord?.year);
  const hasBothYears = productionYear > 0 && recordYear > 0;

  // A record whose year clashes with its own episodes' air year was almost
  // certainly matched to the wrong AniList entry — re-match it.
  if (hasBothYears && Math.abs(recordYear - productionYear) >= 2) return true;

  // Named seasons (e.g. Nisemonogatari) legitimately carry no season marker;
  // a consistent year means the match is fine and needs no refresh churn.
  const yearConsistent = hasBothYears && Math.abs(recordYear - productionYear) <= 1;

  const titleText = titleTextForAnimeRecord(existingRecord);
  if (!seasonMarkerMatches(titleText, seasonNumber) && !yearConsistent) return true;

  if (
    syncContext.maxEpisodeNumber &&
    existingRecord?.episodes_total &&
    Number(existingRecord.episodes_total) < Number(syncContext.maxEpisodeNumber)
  ) {
    return true;
  }

  return false;
}

function updateAnimeMetadata(db, animeId, animeData) {
  if (!animeData) return false;

  if (animeData.anilist_id) {
    const existingByAnilist = db.prepare('SELECT id FROM anime WHERE anilist_id = ? AND id != ?')
      .get(animeData.anilist_id, animeId);
    if (existingByAnilist) return false;
  }

  db.prepare(`
    UPDATE anime
    SET title = ?,
      title_romaji = ?,
      title_english = ?,
      description = ?,
      cover_image = ?,
      banner_image = ?,
      genres = ?,
      status = ?,
      episodes_total = ?,
      rating = ?,
      year = ?,
      season = ?,
      format = ?,
      studios = ?,
      anilist_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    animeData.title,
    animeData.title_romaji,
    animeData.title_english,
    animeData.description,
    animeData.cover_image,
    animeData.banner_image,
    animeData.genres,
    animeData.status,
    animeData.episodes_total,
    animeData.rating,
    animeData.year,
    animeData.season,
    animeData.format,
    animeData.studios,
    animeData.anilist_id,
    animeId
  );

  return true;
}

function findExistingAnime(db, item, kind = itemKind(item), syncContext = {}) {
  const syncJellyfinId = syncJellyfinIdForItem(item, kind, syncContext);
  const existingByJellyfin = db.prepare('SELECT id, format FROM anime WHERE jellyfin_id = ?').get(syncJellyfinId);
  if (existingByJellyfin) return existingByJellyfin;

  const existingByLegacyJellyfin = db.prepare('SELECT * FROM anime WHERE jellyfin_id = ?').get(item.Id);
  if (existingByLegacyJellyfin && existingAnimeMatchesSeason(existingByLegacyJellyfin, syncContext)) {
    db.prepare('UPDATE anime SET jellyfin_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(syncJellyfinId, existingByLegacyJellyfin.id);
    return existingByLegacyJellyfin;
  }

  const existingByTitle = db.prepare(`
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

  if (!existingByTitle) return null;

  const existingTitleRecord = db.prepare('SELECT * FROM anime WHERE id = ?').get(existingByTitle.id);
  return existingAnimeMatchesSeason(existingTitleRecord, syncContext) ? existingByTitle : null;
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

async function ensureAnimeForJellyfinItem(db, item, result, syncContext = {}) {
  const kind = itemKind(item);
  const syncJellyfinId = syncJellyfinIdForItem(item, kind, syncContext);
  const existing = findExistingAnime(db, item, kind, syncContext);

  if (existing) {
    db.prepare(`
      UPDATE anime
      SET jellyfin_id = ?
      WHERE id = ? AND (jellyfin_id IS NULL OR TRIM(jellyfin_id) = '' OR jellyfin_id = ?)
    `).run(syncJellyfinId, existing.id, item.Id);

    const existingRecord = db.prepare('SELECT * FROM anime WHERE id = ?').get(existing.id);
    if (shouldRefreshExistingAnimeMetadata(existingRecord, syncContext)) {
      try {
        const animeData = await anilistDataForItem(item, kind, syncContext);
        if (animeData && updateAnimeMetadata(db, existing.id, animeData)) {
          result.anilist_id = animeData.anilist_id || null;
        }
      } catch (anilistErr) {
        console.warn(`AniList refresh failed for "${item.Name}":`, anilistErr.message);
      }
    } else if (shouldRefreshMissingRating(existingRecord)) {
      // Fetch by the already-matched AniList id (no title re-search, so no
      // risk of re-matching to a different entry).
      try {
        const fullMedia = await getAnilistAnime(existingRecord.anilist_id);
        const animeData = fullMedia ? formatAnilistData(fullMedia) : null;
        if (animeData && updateAnimeMetadata(db, existing.id, animeData)) {
          result.anilist_id = animeData.anilist_id || null;
        }
      } catch (anilistErr) {
        console.warn(`AniList rating refresh failed for "${item.Name}":`, anilistErr.message);
      }
    }

    return {
      animeId: existing.id,
      status: 'updated',
    };
  }

  let animeData = null;
  try {
    animeData = await anilistDataForItem(item, kind, syncContext);
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
      WHERE id = ? AND (jellyfin_id IS NULL OR TRIM(jellyfin_id) = '' OR jellyfin_id = ?)
    `).run(syncJellyfinId, existingByAnilist.id, item.Id);

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
    animeData.format || formatLabelForKind(kind), animeData.studios, animeData.anilist_id, syncJellyfinId
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
  const getSyncedEpisode = db.prepare('SELECT * FROM episodes WHERE anime_id = ? AND episode_number = ?');
  const clearUntrustedOverview = db.prepare(`
    UPDATE episodes
    SET overview = NULL
    WHERE id = ? AND manual_metadata != 1
  `);
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
    const overviewTrust = episodeOverviewTrust({
      episode_number: epNumber,
      title: epTitle,
      overview: metadata.overview,
      provider_ids: metadata.providerIds,
      air_date: metadata.airDate,
      manual_metadata: 0,
    }, animeRecord, { sourceTitle: ep?.Name });
    const overviewForDb = overviewTrust.trusted ? metadata.overview : null;

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
        overviewForDb,
        metadata.runtimeTicks,
        metadata.providerIds,
        metadata.seasonNumber,
        metadata.productionYear
      );
      const syncedEpisode = getSyncedEpisode.get(animeId, epNumber);
      const syncedOverviewTrust = syncedEpisode
        ? episodeOverviewTrust(syncedEpisode, animeRecord, { sourceTitle: ep?.Name })
        : { trusted: true, missing: false };
      if (syncedEpisode && !syncedOverviewTrust.trusted && !syncedOverviewTrust.missing) {
        clearUntrustedOverview.run(syncedEpisode.id);
      }

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

async function fetchSeriesEpisodeItems(series) {
  const episodesData = await jellyfinFetch(itemsEndpoint({
    parentId: series.Id,
    recursive: 'true',
    IncludeItemTypes: 'Episode',
    fields: EPISODE_FIELDS,
    sortBy: 'ParentIndexNumber,IndexNumber,SortName',
    sortOrder: 'Ascending',
  }));

  return episodesData.Items || [];
}

async function syncEntriesForLibraryItem(item) {
  const kind = itemKind(item);

  if (kind === 'movie') {
    return [{
      item,
      kind,
      episodeItems: null,
      syncContext: {},
      syncJellyfinId: syncJellyfinIdForItem(item, kind, {}),
    }];
  }

  const episodeItems = await fetchSeriesEpisodeItems(item);
  const groups = syncGroupsForSeriesEpisodes(episodeItems);
  const resolvedGroups = groups.length > 0
    ? groups
    : [{ episodeItems: [], syncContext: {} }];

  return resolvedGroups.map(group => ({
    item,
    kind,
    episodeItems: group.episodeItems,
    syncContext: group.syncContext,
    syncJellyfinId: syncJellyfinIdForItem(item, kind, group.syncContext),
  }));
}

async function syncEntriesForLibraryItems(items) {
  const entries = [];

  for (const item of items) {
    entries.push(...await syncEntriesForLibraryItem(item));
  }

  return entries;
}

async function syncSeriesEpisodes(db, series, animeId, animeRecord, episodeItems = null) {
  const resolvedEpisodeItems = episodeItems || await fetchSeriesEpisodeItems(series);

  return syncEpisodeRows(db, {
    animeId,
    sourceName: series.Name,
    animeRecord,
    episodeItems: resolvedEpisodeItems,
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
  const syncEntries = await syncEntriesForLibraryItems(jellyfinItems);
  const jellyfinItemIds = new Set(syncEntries.map(entry => String(entry.syncJellyfinId)));
  const existingAnime = db.prepare('SELECT * FROM anime').all();
  const preview = syncEntries.map(entry => makePreviewItem(db, entry.item, entry.syncContext));
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
  const libraryItems = await fetchLibraryItems();
  const syncEntries = await syncEntriesForLibraryItems(libraryItems);
  let entriesToSync = [];

  if (syncAll) {
    entriesToSync = syncEntries;
  } else if (jellyfinIds?.length > 0) {
    const requestedIds = new Set(jellyfinIds.map(String));
    entriesToSync = syncEntries.filter(entry => (
      requestedIds.has(String(entry.item.Id)) ||
      requestedIds.has(String(entry.syncJellyfinId))
    ));
  } else {
    throw new Error('Provide jellyfin_ids or sync_all');
  }

  const results = [];

  for (const entry of entriesToSync) {
    const { item, kind, episodeItems, syncContext, syncJellyfinId } = entry;
    const itemResult = {
      jellyfin_id: syncJellyfinId,
      source_jellyfin_id: item.Id,
      season_number: syncContext.seasonNumber || null,
      name: syncNameForItem(item, kind, syncContext),
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
      const animeState = await ensureAnimeForJellyfinItem(db, item, itemResult, syncContext);
      itemResult.anime_id = animeState.animeId;
      itemResult.status = animeState.status;

      const animeRecord = db.prepare(`
        SELECT anilist_id, title, title_romaji, title_english
        FROM anime
        WHERE id = ?
      `).get(animeState.animeId);
      const episodeStats = kind === 'movie'
        ? syncMovieFile(db, item, animeState.animeId, animeRecord)
        : await syncSeriesEpisodes(db, item, animeState.animeId, animeRecord, episodeItems);

      Object.assign(itemResult, episodeStats);
    } catch (itemErr) {
      itemResult.status = 'error';
      itemResult.error = itemErr.message;
    }

    results.push(itemResult);
  }

  const removedItems = syncAll && entriesToSync.length > 0
    ? pruneMissingJellyfinItems(db, syncEntries.map(entry => entry.syncJellyfinId))
    : [];

  return {
    synced: results.length,
    removed_count: removedItems.length,
    removed_series: removedItems,
    removed_items: removedItems,
    results,
  };
}
