import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db';
import { isJellyfinAnimeMoviePath, mediaRootMappings, normalizeSlash, relativeFromRoot } from './media-roots';

const MASS_DELETE_GUARD_RATIO = 0.8;

function enabled() {
  if (process.env.LOCAL_MEDIA_PRUNE_ENABLED === 'true') return true;
  if (process.env.LOCAL_MEDIA_PRUNE_ENABLED === 'false') return false;
  return process.env.MEDIA_WATCHER_ENABLED !== 'false';
}

function splitRelative(value) {
  return normalizeSlash(value).split('/').filter(Boolean);
}

function isAbsoluteLike(filePath) {
  return path.isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/');
}

function localPathForEpisode(filePath, mappings) {
  if (!filePath || !mappings.length) return null;

  for (const mapping of mappings) {
    const fromJellyfinRoot = relativeFromRoot(filePath, mapping.jellyfinRoot);
    if (fromJellyfinRoot !== null) {
      return path.join(mapping.root, ...splitRelative(fromJellyfinRoot));
    }

    const fromMediaRoot = relativeFromRoot(filePath, mapping.root);
    if (fromMediaRoot !== null) {
      return path.join(mapping.root, ...splitRelative(fromMediaRoot));
    }
  }

  const primaryRoot = mappings[0]?.root;

  if (!mappings.some(mapping => mapping.kind === 'movie') && isJellyfinAnimeMoviePath(filePath)) {
    return null;
  }

  if (isAbsoluteLike(filePath)) {
    return filePath;
  }

  return primaryRoot ? path.join(primaryRoot, ...splitRelative(filePath)) : null;
}

export function pruneMissingLocalMedia() {
  if (!enabled()) {
    return { skipped: true, reason: 'disabled', removed_episodes: [], removed_series: [] };
  }

  const mappings = mediaRootMappings()
    .map(mapping => ({
      ...mapping,
      root: path.resolve(mapping.root),
    }))
    .filter(mapping => mapping.root && fs.existsSync(mapping.root));

  if (mappings.length === 0) {
    return { skipped: true, reason: 'media-root-unavailable', removed_episodes: [], removed_series: [] };
  }

  const db = getDb();
  const episodes = db.prepare(`
    SELECT e.id, e.anime_id, e.episode_number, e.title, e.file_path, a.title AS anime_title
    FROM episodes e
    JOIN anime a ON a.id = e.anime_id
    WHERE e.jellyfin_item_id IS NOT NULL AND TRIM(e.jellyfin_item_id) != ''
  `).all();
  const checkedEpisodes = episodes
    .map(episode => ({
      ...episode,
      local_path: localPathForEpisode(episode.file_path, mappings),
    }))
    .filter(episode => episode.local_path);
  const missingEpisodes = checkedEpisodes.filter(episode => !fs.existsSync(episode.local_path));

  if (missingEpisodes.length === 0) {
    return { skipped: false, removed_episodes: [], removed_series: [] };
  }

  const missingRatio = missingEpisodes.length / Math.max(1, checkedEpisodes.length);
  if (
    checkedEpisodes.length > 0 &&
    missingRatio >= MASS_DELETE_GUARD_RATIO &&
    process.env.LOCAL_MEDIA_PRUNE_ALLOW_MASS_DELETE !== 'true'
  ) {
    return {
      skipped: true,
      reason: 'mass-delete-guard',
      checked_count: checkedEpisodes.length,
      missing_count: missingEpisodes.length,
      removed_episodes: [],
      removed_series: [],
    };
  }

  const applyPrune = db.transaction(() => {
    const deleteEpisode = db.prepare('DELETE FROM episodes WHERE id = ?');
    const remainingEpisodes = db.prepare('SELECT COUNT(*) AS count FROM episodes WHERE anime_id = ?');
    const getAnime = db.prepare('SELECT id, title, jellyfin_id FROM anime WHERE id = ?');
    const deleteAnime = db.prepare(`
      DELETE FROM anime
      WHERE id = ? AND jellyfin_id IS NOT NULL AND TRIM(jellyfin_id) != ''
    `);
    const touchedAnimeIds = new Set();
    const removedEpisodes = missingEpisodes.map(episode => {
      deleteEpisode.run(episode.id);
      touchedAnimeIds.add(episode.anime_id);

      return {
        episode_id: episode.id,
        anime_id: episode.anime_id,
        anime_title: episode.anime_title,
        episode_number: episode.episode_number,
        title: episode.title,
        file_path: episode.file_path,
        local_path: episode.local_path,
      };
    });
    const removedSeries = [];

    for (const animeId of touchedAnimeIds) {
      const remaining = remainingEpisodes.get(animeId)?.count || 0;
      if (remaining > 0) continue;

      const anime = getAnime.get(animeId);
      if (!anime) continue;

      const result = deleteAnime.run(animeId);
      if (result.changes > 0) {
        removedSeries.push({
          anime_id: anime.id,
          title: anime.title,
          jellyfin_id: anime.jellyfin_id,
          status: 'removed-local-files-missing',
        });
      }
    }

    return { removedEpisodes, removedSeries };
  });
  const result = applyPrune();

  return {
    skipped: false,
    checked_count: checkedEpisodes.length,
    missing_count: missingEpisodes.length,
    removed_episodes: result.removedEpisodes,
    removed_series: result.removedSeries,
  };
}
