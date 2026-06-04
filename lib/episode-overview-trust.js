const DEFAULT_LOOKBACK_DAYS = 45;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function trim(value) {
  return String(value || '').trim();
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function episodeOverviewTrustLookbackDays() {
  return numberFromEnv(
    'EPISODE_OVERVIEW_TRUST_LOOKBACK_DAYS',
    numberFromEnv('MISSING_EPISODE_METADATA_REFRESH_LOOKBACK_DAYS', DEFAULT_LOOKBACK_DAYS)
  );
}

export function parseProviderIds(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function hasProviderIds(value) {
  const providerIds = parseProviderIds(value);
  return Object.values(providerIds).some(providerId => trim(providerId));
}

export function isGenericEpisodeTitle(title, episodeNumber) {
  const text = trim(title);
  const number = Number(episodeNumber);

  if (!text || !Number.isFinite(number)) return false;

  const padded = String(number).padStart(2, '0');
  const escaped = String(number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedPadded = padded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const genericPatterns = [
    new RegExp(`^episode\\s*#?\\s*${escaped}$`, 'i'),
    new RegExp(`^episode\\s*#?\\s*${escapedPadded}$`, 'i'),
    new RegExp(`^ep\\.?\\s*${escaped}$`, 'i'),
    new RegExp(`^ep\\.?\\s*${escapedPadded}$`, 'i'),
    new RegExp(`^e\\s*${escaped}$`, 'i'),
    new RegExp(`^e\\s*${escapedPadded}$`, 'i'),
    new RegExp(`^\\d+\\.\\s*${escaped}$`, 'i'),
    new RegExp(`^s\\d{1,3}\\.?e\\s*${escaped}$`, 'i'),
    new RegExp(`^s\\d{1,3}\\.?e\\s*${escapedPadded}$`, 'i'),
  ];

  return text === String(number) || text === padded || genericPatterns.some(pattern => pattern.test(text));
}

function isReleasingAnime(anime) {
  const status = trim(anime?.status || anime?.anime_status).toUpperCase();
  return status === 'RELEASING' || status === 'NOT_YET_RELEASED';
}

function dateValue(value) {
  if (!value) return null;

  const parsed = new Date(value);
  const time = parsed.valueOf();
  return Number.isFinite(time) ? time : null;
}

function isRecentEpisode(episode, lookbackDays) {
  const timestamp = dateValue(episode?.air_date || episode?.PremiereDate || episode?.created_at);
  if (!timestamp) return true;

  const ageMs = Date.now() - timestamp;
  return ageMs >= -ONE_DAY_MS && ageMs <= lookbackDays * ONE_DAY_MS;
}

function normalizeOverview(value) {
  return trim(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function hasDuplicateOverview(episode, siblingEpisodes = []) {
  const overview = normalizeOverview(episode?.overview || episode?.Overview);
  if (!overview) return false;

  const episodeNumber = Number(episode?.episode_number || episode?.IndexNumber);
  return siblingEpisodes.some(sibling => {
    const siblingNumber = Number(sibling?.episode_number || sibling?.IndexNumber);
    if (Number.isFinite(episodeNumber) && Number.isFinite(siblingNumber) && episodeNumber === siblingNumber) {
      return false;
    }

    return normalizeOverview(sibling?.overview || sibling?.Overview) === overview;
  });
}

export function episodeOverviewTrust(episode, anime = {}, options = {}) {
  const overview = trim(episode?.overview || episode?.Overview);

  if (!overview) {
    return { trusted: false, missing: true, reason: 'missing' };
  }

  if (Number(episode?.manual_metadata) === 1) {
    return { trusted: true, missing: false, reason: 'manual' };
  }

  const lookbackDays = Number.isFinite(options.lookbackDays)
    ? options.lookbackDays
    : episodeOverviewTrustLookbackDays();
  const providerless = !hasProviderIds(episode?.provider_ids ?? episode?.ProviderIds);
  const recent = isRecentEpisode(episode, lookbackDays);
  const sourceTitle = options.sourceTitle ?? episode?.source_title ?? episode?.Name ?? episode?.title;
  const genericSourceTitle = isGenericEpisodeTitle(sourceTitle, episode?.episode_number || episode?.IndexNumber);

  if (hasDuplicateOverview(episode, options.siblingEpisodes)) {
    return { trusted: false, missing: false, reason: 'duplicate-overview' };
  }

  if (isReleasingAnime(anime) && recent && providerless) {
    return {
      trusted: false,
      missing: false,
      reason: genericSourceTitle ? 'providerless-generic-recent' : 'providerless-recent',
    };
  }

  return { trusted: true, missing: false, reason: 'trusted' };
}

export function episodeNeedsMetadataRefresh(episode, anime = {}, options = {}) {
  return !episodeOverviewTrust(episode, anime, options).trusted;
}

export function sanitizeEpisodesForPublic(episodes, anime = {}) {
  return episodes.map(episode => {
    const trust = episodeOverviewTrust(episode, anime, { siblingEpisodes: episodes });
    if (trust.trusted) {
      return {
        ...episode,
        overview_untrusted: false,
      };
    }

    return {
      ...episode,
      overview: null,
      overview_untrusted: !trust.missing,
      overview_trust_reason: trust.reason,
    };
  });
}
