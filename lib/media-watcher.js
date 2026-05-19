import fs from 'node:fs';
import path from 'node:path';
import { enqueueRescanJob } from './rescan-jobs';

const GLOBAL_KEY = Symbol.for('cultanime.mediaWatcher');
const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.m4v',
  '.avi',
  '.mov',
  '.webm',
  '.wmv',
  '.flv',
  '.ts',
]);
const TEMP_EXTENSIONS = new Set([
  '.part',
  '.partial',
  '.tmp',
  '.temp',
  '.crdownload',
]);

function getState() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      started: false,
      enabled: false,
      root: null,
      jellyfinRoot: null,
      debounceMs: 60000,
      watchers: new Map(),
      pending: new Map(),
      timer: null,
      eventCount: 0,
      lastEventAt: null,
      lastJob: null,
      lastError: null,
    };
  }
  return globalThis[GLOBAL_KEY];
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeLocalRoot(value) {
  return value ? path.resolve(value) : null;
}

function normalizeJellyfinRoot(value) {
  return value ? value.replace(/[\\/]+$/, '') : null;
}

function splitRelative(relativePath) {
  return relativePath.split(/[\\/]+/).filter(Boolean);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function shouldIgnore(changedPath) {
  const baseName = path.basename(changedPath).toLowerCase();
  const extension = path.extname(baseName);

  return (
    TEMP_EXTENSIONS.has(extension) ||
    baseName.endsWith('.!qb') ||
    baseName.endsWith('.aria2') ||
    baseName === '.ds_store' ||
    baseName === 'thumbs.db'
  );
}

function isRelevantPath(changedPath) {
  try {
    if (fs.existsSync(changedPath) && fs.statSync(changedPath).isDirectory()) {
      return true;
    }
  } catch {
    return false;
  }

  return VIDEO_EXTENSIONS.has(path.extname(changedPath).toLowerCase());
}

function seriesRootForPath(mediaRoot, changedPath) {
  if (!isInside(mediaRoot, changedPath)) return mediaRoot;

  const relative = path.relative(mediaRoot, changedPath);
  const [seriesFolder] = splitRelative(relative);
  return seriesFolder ? path.join(mediaRoot, seriesFolder) : changedPath;
}

function mapLocalPathToJellyfin(mediaRoot, jellyfinRoot, localPath) {
  const relative = path.relative(mediaRoot, localPath);
  const relativeParts = splitRelative(relative);
  const suffix = relativeParts.join('/');

  if (!suffix) return jellyfinRoot;
  return `${jellyfinRoot}/${suffix}`;
}

function mergeUpdateType(previous, next) {
  if (!previous) return next;
  if (previous === 'Deleted' || next === 'Deleted') return 'Deleted';
  if (previous === 'Created' || next === 'Created') return 'Created';
  return next || previous;
}

function walkDirectories(root, visit) {
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    visit(current);

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }
}

function scheduleFlush(state) {
  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = null;
    flushPendingChanges(state);
  }, state.debounceMs);
}

function flushPendingChanges(state) {
  const updates = [...state.pending.values()];
  state.pending.clear();

  if (updates.length === 0) return;

  try {
    state.lastJob = enqueueRescanJob({
      reason: 'media-watcher',
      updates,
      syncAfter: true,
    });
  } catch (error) {
    state.lastError = error.message;
  }
}

function recordChange(state, changedPath, updateType) {
  if (!changedPath || shouldIgnore(changedPath)) return;

  const exists = fs.existsSync(changedPath);
  const effectiveUpdateType = exists ? updateType : 'Deleted';
  const localScanRoot = seriesRootForPath(state.root, changedPath);
  const jellyfinPath = mapLocalPathToJellyfin(state.root, state.jellyfinRoot, localScanRoot);
  const previous = state.pending.get(jellyfinPath);

  state.pending.set(jellyfinPath, {
    path: jellyfinPath,
    updateType: mergeUpdateType(previous?.updateType, effectiveUpdateType),
  });
  state.eventCount++;
  state.lastEventAt = new Date().toISOString();
  scheduleFlush(state);
}

function watchDirectory(state, dir) {
  if (state.watchers.has(dir)) return;

  try {
    const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
      const changedPath = filename ? path.join(dir, String(filename)) : dir;

      if (eventType === 'rename') {
        try {
          if (fs.existsSync(changedPath) && fs.statSync(changedPath).isDirectory()) {
            walkDirectories(changedPath, childDir => watchDirectory(state, childDir));
          }
        } catch {
          // The path may have disappeared between the event and the stat call.
        }
      }

      if (!isRelevantPath(changedPath) && fs.existsSync(changedPath)) return;
      recordChange(state, changedPath, eventType === 'rename' ? 'Created' : 'Modified');
    });

    watcher.on('error', error => {
      state.lastError = error.message;
    });

    state.watchers.set(dir, watcher);
  } catch (error) {
    state.lastError = error.message;
  }
}

export function ensureMediaWatcher() {
  const state = getState();
  const enabled = process.env.MEDIA_WATCHER_ENABLED !== 'false';
  const root = normalizeLocalRoot(process.env.MEDIA_ROOT);
  const jellyfinRoot = normalizeJellyfinRoot(process.env.JELLYFIN_MEDIA_ROOT || process.env.MEDIA_ROOT);

  state.enabled = enabled;
  state.root = root;
  state.jellyfinRoot = jellyfinRoot;
  state.debounceMs = numberFromEnv('MEDIA_RESCAN_DEBOUNCE_MS', 60000);

  if (!enabled) {
    state.lastError = null;
    return getMediaWatcherStatus();
  }

  if (state.started) {
    return getMediaWatcherStatus();
  }

  if (!root || !jellyfinRoot) {
    state.lastError = 'MEDIA_ROOT is not configured.';
    return getMediaWatcherStatus();
  }

  if (!fs.existsSync(root)) {
    state.lastError = `MEDIA_ROOT does not exist: ${root}`;
    return getMediaWatcherStatus();
  }

  walkDirectories(root, dir => watchDirectory(state, dir));
  state.started = true;
  state.lastError = null;
  return getMediaWatcherStatus();
}

export function stopMediaWatcher() {
  const state = getState();

  for (const watcher of state.watchers.values()) {
    watcher.close();
  }

  state.watchers.clear();
  state.pending.clear();
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.started = false;
  return getMediaWatcherStatus();
}

export function getMediaWatcherStatus() {
  const state = getState();

  return {
    enabled: state.enabled,
    started: state.started,
    root: state.root,
    jellyfinRoot: state.jellyfinRoot,
    debounceMs: state.debounceMs,
    watchedDirectories: state.watchers.size,
    pendingUpdates: [...state.pending.values()],
    eventCount: state.eventCount,
    lastEventAt: state.lastEventAt,
    lastJob: state.lastJob,
    lastError: state.lastError,
  };
}

export function queueMediaChange(changedPath, updateType = 'Modified') {
  const state = getState();

  if (!state.started) {
    ensureMediaWatcher();
  }

  if (!state.root || !state.jellyfinRoot) {
    throw new Error('Media watcher is not configured.');
  }

  const absolutePath = path.resolve(changedPath);
  recordChange(state, absolutePath, updateType);
  return getMediaWatcherStatus();
}
