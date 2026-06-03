import { getDb } from './db';
import { refreshJellyfinItemMetadata } from './jellyfin';

const GLOBAL_KEY = Symbol.for('cultanime.missingMetadataRefresh');
const DEFAULT_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 45;
const DEFAULT_BATCH_LIMIT = 8;

function getState() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      attemptedAtByItemId: new Map(),
      lastResult: null,
    };
  }

  return globalThis[GLOBAL_KEY];
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function enabled() {
  return process.env.MISSING_EPISODE_METADATA_REFRESH_ENABLED !== 'false';
}

function cutoffDate(days) {
  const date = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  return date.toISOString().slice(0, 10);
}

function cutoffDateTime(days) {
  return `${cutoffDate(days)} 00:00:00`;
}

function getCandidates(db, { lookbackDays, limit }) {
  return db.prepare(`
    SELECT
      e.id,
      e.episode_number,
      e.air_date,
      e.created_at,
      e.jellyfin_item_id,
      a.id AS anime_id,
      a.title AS anime_title
    FROM episodes e
    JOIN anime a ON a.id = e.anime_id
    WHERE e.manual_metadata != 1
      AND e.jellyfin_item_id IS NOT NULL
      AND TRIM(e.jellyfin_item_id) != ''
      AND (e.overview IS NULL OR TRIM(e.overview) = '')
      AND (
        e.air_date IS NULL
        OR e.air_date >= ?
        OR e.created_at >= ?
      )
    ORDER BY COALESCE(e.air_date, e.created_at) DESC, e.id DESC
    LIMIT ?
  `).all(cutoffDate(lookbackDays), cutoffDateTime(lookbackDays), limit);
}

function shouldRetry(state, itemId, retryIntervalMs, now) {
  const lastAttemptedAt = state.attemptedAtByItemId.get(itemId);
  return !lastAttemptedAt || (now - lastAttemptedAt) >= retryIntervalMs;
}

function publicEpisode(episode) {
  return {
    episode_id: episode.id,
    anime_id: episode.anime_id,
    anime_title: episode.anime_title,
    episode_number: episode.episode_number,
    jellyfin_item_id: episode.jellyfin_item_id,
  };
}

export async function refreshMissingEpisodeMetadata(options = {}) {
  const state = getState();

  if (!enabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  const retryIntervalMs = numberFromEnv(
    'MISSING_EPISODE_METADATA_REFRESH_INTERVAL_MS',
    DEFAULT_RETRY_INTERVAL_MS
  );
  const lookbackDays = numberFromEnv(
    'MISSING_EPISODE_METADATA_REFRESH_LOOKBACK_DAYS',
    DEFAULT_LOOKBACK_DAYS
  );
  const limit = numberFromEnv(
    'MISSING_EPISODE_METADATA_REFRESH_BATCH_LIMIT',
    DEFAULT_BATCH_LIMIT
  );
  const db = getDb();
  const candidates = getCandidates(db, { lookbackDays, limit });
  const now = Date.now();
  const targets = options.force
    ? candidates
    : candidates.filter(episode => shouldRetry(state, episode.jellyfin_item_id, retryIntervalMs, now));
  const refreshed = [];
  const errors = [];

  for (const episode of targets) {
    state.attemptedAtByItemId.set(episode.jellyfin_item_id, now);

    try {
      await refreshJellyfinItemMetadata(episode.jellyfin_item_id, {
        metadataRefreshMode: 'FullRefresh',
        imageRefreshMode: 'Default',
        replaceAllMetadata: false,
        replaceAllImages: false,
      });
      refreshed.push(publicEpisode(episode));
    } catch (error) {
      errors.push({
        ...publicEpisode(episode),
        error: error.message,
      });
    }
  }

  state.lastResult = {
    skipped: false,
    checked: candidates.length,
    refreshed: refreshed.length,
    rate_limited: candidates.length - targets.length,
    errors,
    refreshed_episodes: refreshed,
  };

  return state.lastResult;
}
