import { getDb } from './db';
import { findItemByPath, getItemById } from './jellyfin';

export function getProxiedSubtitleUrl(itemId, mediaSourceId, streamIndex) {
  const params = new URLSearchParams({
    itemId,
    mediaSourceId,
    streamIndex: String(streamIndex),
  });

  return `/api/subtitles?${params.toString()}`;
}

export function chooseSubtitle(subtitles, requestedIndex) {
  if (requestedIndex !== null && requestedIndex !== undefined) {
    const requested = subtitles.find(sub => String(sub.index) === String(requestedIndex));
    if (requested) return requested;
  }

  return subtitles.find(sub => sub.isDefault)
    || subtitles.find(sub => sub.language.toLowerCase().startsWith('en'))
    || subtitles[0]
    || null;
}

export function requiresBurnedInSubtitle(subtitle) {
  const codec = (subtitle?.codec || '').toLowerCase();
  return codec === 'ass' || codec === 'ssa';
}

export async function resolveEpisodePlayback(episodeId) {
  const db = getDb();
  const episode = db.prepare(`
    SELECT e.*, a.title AS anime_title
    FROM episodes e
    LEFT JOIN anime a ON a.id = e.anime_id
    WHERE e.id = ?
  `).get(episodeId);

  if (!episode) return null;

  let jellyfinItemId = episode.jellyfin_item_id;

  if (!jellyfinItemId) {
    const mediaRoot = process.env.MEDIA_ROOT || '/media/anime';
    const fullPath = episode.file_path.startsWith('/')
      ? episode.file_path
      : `${mediaRoot}/${episode.file_path}`;

    const item = await findItemByPath(fullPath);

    if (!item) {
      const error = new Error(`Could not find a Jellyfin item matching path: ${fullPath}. Make sure Jellyfin has scanned this file.`);
      error.code = 'JELLYFIN_ITEM_NOT_FOUND';
      throw error;
    }

    jellyfinItemId = item.Id;

    try {
      db.prepare('UPDATE episodes SET jellyfin_item_id = ? WHERE id = ?').run(jellyfinItemId, episodeId);
    } catch (cacheErr) {
      console.warn('Could not cache jellyfin_item_id:', cacheErr.message);
    }
  }

  const itemInfo = await getItemById(jellyfinItemId);
  const mediaSource = itemInfo?.MediaSources?.[0];
  const mediaSourceId = mediaSource?.Id || jellyfinItemId;
  const mediaStreams = mediaSource?.MediaStreams || itemInfo?.MediaStreams || [];
  const subtitles = mediaStreams
    .filter(stream => stream.Type === 'Subtitle')
    .map(stream => ({
      index: stream.Index,
      language: stream.Language || 'und',
      title: stream.DisplayTitle || stream.Title || stream.Language || `Subtitle ${stream.Index}`,
      url: getProxiedSubtitleUrl(jellyfinItemId, mediaSourceId, stream.Index),
      isDefault: Boolean(stream.IsDefault),
      isForced: Boolean(stream.IsForced),
      codec: stream.Codec || null,
    }));

  return {
    episode,
    itemInfo,
    jellyfinItemId,
    mediaSource,
    mediaSourceId,
    mediaStreams,
    subtitles,
  };
}
