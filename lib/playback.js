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

function streamText(stream) {
  return `${stream?.language || ''} ${stream?.title || ''}`.toLowerCase();
}

function isJapaneseAudioTrack(track) {
  const text = streamText(track);
  return text.includes('jpn') || text.includes('japanese') || text.includes('ja ');
}

function isEnglishSubtitle(subtitle) {
  const text = streamText(subtitle);
  return text.includes('eng') || text.includes('english') || text.includes(' en ');
}

function isSignsOnlySubtitle(subtitle) {
  const text = streamText(subtitle);
  return subtitle?.isForced
    || text.includes('forced')
    || text.includes('signs')
    || text.includes('songs');
}

function isFullSubtitle(subtitle) {
  const text = streamText(subtitle);
  return text.includes('full') || text.includes('dialog') || text.includes('dialogue');
}

export function chooseSubtitle(subtitles, requestedIndex) {
  if (requestedIndex !== null && requestedIndex !== undefined) {
    const requested = subtitles.find(sub => String(sub.index) === String(requestedIndex));
    if (requested) return requested;
  }

  return subtitles.find(sub => isEnglishSubtitle(sub) && isFullSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isEnglishSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isFullSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isEnglishSubtitle(sub))
    || subtitles.find(sub => sub.isDefault)
    || subtitles[0]
    || null;
}

export function chooseAudioTrack(audioTracks, requestedIndex) {
  if (requestedIndex !== null && requestedIndex !== undefined) {
    const requested = audioTracks.find(track => String(track.index) === String(requestedIndex));
    if (requested) return requested;
  }

  return audioTracks.find(track => isJapaneseAudioTrack(track))
    || audioTracks.find(track => track.isDefault)
    || audioTracks[0]
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
  const audioTracks = mediaStreams
    .filter(stream => stream.Type === 'Audio')
    .map(stream => ({
      index: stream.Index,
      language: stream.Language || 'und',
      title: stream.DisplayTitle || stream.Title || stream.Language || `Audio ${stream.Index}`,
      isDefault: Boolean(stream.IsDefault),
      codec: stream.Codec || null,
      channels: stream.Channels || null,
    }));
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
    audioTracks,
    subtitles,
  };
}
