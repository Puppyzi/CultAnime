import { syncJellyfinLibrary } from './admin-sync';
import { pruneMissingLocalMedia } from './local-media-prune';

const GLOBAL_KEY = Symbol.for('cultanime.libraryReconciler');
const DEFAULT_INTERVAL_MS = 60000;
const DEFAULT_STARTUP_DELAY_MS = 5000;
const DEFAULT_ON_READ_INTERVAL_MS = 0;
const DEFAULT_ON_READ_TIMEOUT_MS = 12000;

function getState() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      started: false,
      enabled: false,
      timer: null,
      queue: Promise.resolve(),
      running: false,
      queued: false,
      intervalMs: DEFAULT_INTERVAL_MS,
      startupDelayMs: DEFAULT_STARTUP_DELAY_MS,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastReason: null,
      lastResult: null,
      lastError: null,
      runCount: 0,
      skippedCount: 0,
    };
  }
  return globalThis[GLOBAL_KEY];
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function jellyfinConfigured() {
  const url = process.env.JELLYFIN_URL || '';
  const apiKey = process.env.JELLYFIN_API_KEY || '';

  return Boolean(
    url &&
    apiKey &&
    !url.includes('YOUR_') &&
    !url.includes('your-') &&
    !apiKey.includes('replace_') &&
    !apiKey.includes('your-')
  );
}

function shouldEnable() {
  if (process.env.LIBRARY_RECONCILE_ENABLED === 'false') return false;
  return jellyfinConfigured();
}

function msSince(value) {
  if (!value) return Infinity;
  const started = new Date(value).valueOf();
  if (!Number.isFinite(started)) return Infinity;
  return Date.now() - started;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function publicStatus(state) {
  return {
    enabled: state.enabled,
    started: state.started,
    running: state.running,
    queued: state.queued,
    intervalMs: state.intervalMs,
    startupDelayMs: state.startupDelayMs,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastReason: state.lastReason,
    lastResult: state.lastResult,
    lastError: state.lastError,
    runCount: state.runCount,
    skippedCount: state.skippedCount,
  };
}

async function runReconcile(state, reason) {
  state.running = true;
  state.queued = false;
  state.lastStartedAt = new Date().toISOString();
  state.lastReason = reason;
  state.lastError = null;

  try {
    const localPrune = pruneMissingLocalMedia();
    state.lastResult = {
      local_media_prune: localPrune,
    };
    const result = await syncJellyfinLibrary({ syncAll: true });
    state.lastResult = {
      synced: result.synced,
      removed_count: result.removed_count || 0,
      removed_series: result.removed_series || [],
      episodes_removed: result.results?.reduce((total, item) => total + (item.episodes_removed || 0), 0) || 0,
      local_media_prune: localPrune,
    };
    state.runCount++;
    return result;
  } catch (error) {
    state.lastError = error.message;
    throw error;
  } finally {
    state.running = false;
    state.lastFinishedAt = new Date().toISOString();
  }
}

export function ensureLibraryReconciler() {
  const state = getState();

  state.enabled = shouldEnable();
  state.intervalMs = numberFromEnv('LIBRARY_RECONCILE_INTERVAL_MS', DEFAULT_INTERVAL_MS);
  state.startupDelayMs = numberFromEnv('LIBRARY_RECONCILE_STARTUP_DELAY_MS', DEFAULT_STARTUP_DELAY_MS);

  if (!state.enabled) {
    return publicStatus(state);
  }

  if (state.started) {
    return publicStatus(state);
  }

  state.started = true;

  setTimeout(() => {
    queueLibraryReconcile({ reason: 'startup', minIntervalMs: 0 }).catch(() => {});
  }, state.startupDelayMs).unref?.();

  if (state.intervalMs > 0) {
    state.timer = setInterval(() => {
      queueLibraryReconcile({ reason: 'interval', minIntervalMs: state.intervalMs }).catch(() => {});
    }, state.intervalMs);
    state.timer.unref?.();
  }

  return publicStatus(state);
}

export async function queueLibraryReconcile({ reason = 'manual', minIntervalMs = 0, force = false } = {}) {
  const state = getState();

  ensureLibraryReconciler();

  if (!state.enabled) {
    return { skipped: true, reason: 'disabled', status: publicStatus(state) };
  }

  if (!force) {
    if (state.queued) {
      const result = await state.queue;
      return { skipped: false, result, status: publicStatus(state) };
    }

    if (!state.running && msSince(state.lastFinishedAt) < minIntervalMs) {
      state.skippedCount++;
      return { skipped: true, reason: 'recently-ran', status: publicStatus(state) };
    }
  }

  state.queued = true;
  state.queue = state.queue
    .catch(() => {})
    .then(() => runReconcile(state, reason));

  const result = await state.queue;
  return { skipped: false, result, status: publicStatus(state) };
}

export async function reconcileForRead() {
  const minIntervalMs = numberFromEnv('LIBRARY_RECONCILE_ON_READ_INTERVAL_MS', DEFAULT_ON_READ_INTERVAL_MS);
  const timeoutMs = numberFromEnv('LIBRARY_RECONCILE_ON_READ_TIMEOUT_MS', DEFAULT_ON_READ_TIMEOUT_MS);
  const reconcile = queueLibraryReconcile({ reason: 'anime-read', minIntervalMs });

  try {
    return await Promise.race([
      reconcile,
      wait(timeoutMs).then(() => ({ skipped: true, reason: 'timeout', status: getLibraryReconcilerStatus() })),
    ]);
  } catch (error) {
    return { skipped: true, reason: 'error', error: error.message, status: getLibraryReconcilerStatus() };
  }
}

export function getLibraryReconcilerStatus() {
  return publicStatus(getState());
}
