import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from './db';
import { getEpisodeSegmentData } from './jellyfin';
import {
  normalizeJellyfinSegments,
  parseSkipOverrides,
  resolveSkipSegments,
  safeSegments,
} from './skip-segments';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pending = new Map();

async function sourceKey(episode) {
  const filename = path.isAbsolute(episode.file_path)
    ? episode.file_path
    : path.join(/* turbopackIgnore: true */ process.env.MEDIA_ROOT || '/media/anime', episode.file_path);
  const file = await stat(filename).catch(() => null);
  return digest([
    episode.jellyfin_item_id,
    episode.file_path,
    episode.runtime_ticks,
    episode.duration,
    file?.size,
    file?.mtimeMs,
  ]);
}

async function loadDetected(db, episode, key, refresh) {
  const cached = db.prepare('SELECT * FROM episode_skip_cache WHERE episode_id = ?').get(episode.id);
  const ttl = cached?.status === 'unavailable' ? 10_000 : 60_000;
  if (!refresh && cached?.source_key === key && Date.now() - cached.fetched_at < ttl) {
    return { ...cached, segments: JSON.parse(cached.segments) };
  }
  const upstream = episode.jellyfin_item_id ? await getEpisodeSegmentData(episode.jellyfin_item_id) : null;
  const media = upstream?.media;
  const duration = media?.RunTimeTicks > 0 ? media.RunTimeTicks / 10_000_000 : episode.duration;
  const mediaKey = media ? digest([key, media.Id, media.Path, media.Size, media.RunTimeTicks]) : null;
  const segments = mediaKey ? normalizeJellyfinSegments(upstream?.items, duration) : [];
  const status =
    !mediaKey || !upstream?.available ? 'unavailable' : segments.length ? 'available' : 'unknown';
  const data = {
    source_key: key,
    media_key: mediaKey || '',
    duration,
    segments,
    status,
    fetched_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO episode_skip_cache
    (episode_id, source_key, media_key, duration, segments, status, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(episode_id) DO UPDATE SET source_key=excluded.source_key, media_key=excluded.media_key,
      duration=excluded.duration, segments=excluded.segments, status=excluded.status, fetched_at=excluded.fetched_at
  `
  ).run(episode.id, key, data.media_key, duration || null, JSON.stringify(segments), status, data.fetched_at);
  return data;
}

export async function getEpisodeSegments(episodeId, { db = getDb(), refresh = false } = {}) {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!episode) return null;
  const key = await sourceKey(episode);
  // Deduplicate viewers requesting the same uncached episode at once.
  const requestKey = `${db.name}:${episode.id}:${key}`;
  let promise = pending.get(requestKey);
  if (!promise) {
    promise = loadDetected(db, episode, key, refresh).finally(() => pending.delete(requestKey));
    pending.set(requestKey, promise);
  }
  const detected = await promise;
  const overrides = db
    .prepare('SELECT * FROM episode_skip_overrides WHERE episode_id = ?')
    .all(episodeId)
    .map((row) => ({ ...row, segments: JSON.parse(row.segments) }));
  return {
    episodeId: episode.id,
    mediaKey: detected.media_key,
    duration: detected.duration,
    detectionStatus: detected.status,
    detectedSegments: detected.segments,
    ...resolveSkipSegments(detected.segments, overrides, detected.media_key, detected.duration),
  };
}

export async function saveEpisodeSegments(episodeId, body, { db = getDb() } = {}) {
  const current = await getEpisodeSegments(episodeId, { db, refresh: true });
  if (!current) return null;
  if (!current.mediaKey || body?.mediaKey !== current.mediaKey) {
    const error = new Error(
      'The episode file changed or is unavailable. Reload skip settings before saving.'
    );
    error.status = 409;
    throw error;
  }
  const settings = parseSkipOverrides(body, current.duration);
  const proposed = settings.flatMap((s) => s.segments);
  if (safeSegments(proposed, current.duration).length !== proposed.length) {
    throw new Error('Intro and credits intervals must not overlap.');
  }
  db.transaction(() => {
    for (const setting of settings) {
      db.prepare('DELETE FROM episode_skip_overrides WHERE episode_id = ? AND type = ?').run(
        episodeId,
        setting.type
      );
      if (setting.mode !== 'auto') {
        db.prepare(
          `INSERT INTO episode_skip_overrides (episode_id, type, mode, media_key, segments)
          VALUES (?, ?, ?, ?, ?)`
        ).run(episodeId, setting.type, setting.mode, current.mediaKey, JSON.stringify(setting.segments));
      }
    }
  })();
  return getEpisodeSegments(episodeId, { db });
}
