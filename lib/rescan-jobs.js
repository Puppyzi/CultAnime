import { notifyJellyfinMediaUpdated, refreshJellyfinLibrary } from './jellyfin';
import { syncJellyfinLibrary } from './admin-sync';

const GLOBAL_KEY = Symbol.for('cultanime.rescanJobs');
const MAX_JOB_HISTORY = 25;

function getState() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      jobs: new Map(),
      queue: Promise.resolve(),
      nextId: 1,
    };
  }
  return globalThis[GLOBAL_KEY];
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeUpdates({ paths = [], updates = [], updateType = 'Modified' } = {}) {
  const pathUpdates = paths.map(path => ({ path, updateType }));
  const combined = [...pathUpdates, ...updates]
    .filter(update => update?.path)
    .map(update => ({
      path: String(update.path),
      updateType: update.updateType || updateType || 'Modified',
    }));

  const byKey = new Map();
  for (const update of combined) {
    byKey.set(`${update.path}:${update.updateType}`, update);
  }
  return [...byKey.values()];
}

function trimHistory(state) {
  const jobs = [...state.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const job of jobs.slice(MAX_JOB_HISTORY)) {
    state.jobs.delete(job.id);
  }
}

function publicJob(job) {
  return {
    id: job.id,
    reason: job.reason,
    status: job.status,
    updates: job.updates,
    fullRefresh: job.fullRefresh,
    syncAfter: job.syncAfter,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    message: job.message,
    error: job.error,
    syncResult: job.syncResult,
  };
}

async function runJob(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();

  try {
    if (job.fullRefresh) {
      job.message = 'Requesting a full Jellyfin library refresh...';
      await refreshJellyfinLibrary();
    } else {
      job.message = 'Reporting changed media paths to Jellyfin...';
      await notifyJellyfinMediaUpdated(job.updates);
    }

    const settleMs = numberFromEnv('JELLYFIN_RESCAN_SETTLE_MS', 10000);
    if (settleMs > 0) {
      job.status = 'waiting';
      job.message = 'Waiting for Jellyfin to index the changed files...';
      await wait(settleMs);
    }

    if (job.syncAfter) {
      job.status = 'syncing';
      job.message = 'Syncing Jellyfin changes into CultAnime...';
      job.syncResult = await syncJellyfinLibrary({ syncAll: true });
    }

    job.status = 'completed';
    job.message = 'Rescan and sync completed.';
  } catch (error) {
    job.status = 'error';
    job.error = error.message;
    job.message = 'Rescan job failed.';
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

export function enqueueRescanJob(options = {}) {
  const state = getState();
  const updates = normalizeUpdates(options);
  const fullRefresh = Boolean(options.fullRefresh);

  if (!fullRefresh && updates.length === 0) {
    throw new Error('Provide at least one path or request a full refresh.');
  }

  const id = String(state.nextId++);
  const job = {
    id,
    reason: options.reason || 'manual',
    status: 'queued',
    updates,
    fullRefresh,
    syncAfter: options.syncAfter !== false,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    message: 'Queued for Jellyfin rescan.',
    error: null,
    syncResult: null,
  };

  state.jobs.set(id, job);
  trimHistory(state);

  state.queue = state.queue
    .catch(() => {})
    .then(() => runJob(job));

  return publicJob(job);
}

export function getRescanJobs() {
  const state = getState();
  return [...state.jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicJob);
}

export function getRescanJob(id) {
  const job = getState().jobs.get(String(id));
  return job ? publicJob(job) : null;
}
