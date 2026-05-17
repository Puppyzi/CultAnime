import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { findItemByPath, getItemById, getStreamUrl, getDirectStreamUrl, getSubtitleUrl } from '../../../../lib/jellyfin';

/**
 * GET /api/stream/[episodeId]
 *
 * Returns a JSON object with the Jellyfin HLS stream URL for the requested episode.
 * The frontend uses this URL with hls.js to play the video.
 *
 * Flow:
 *   1. Look up the episode in our local SQLite database.
 *   2. If the episode has a cached jellyfin_item_id, use it directly.
 *   3. Otherwise, search Jellyfin by file path and cache the mapping.
 *   4. Build the HLS stream URL and return it.
 */
export async function GET(request, { params }) {
  try {
    const { episodeId } = await params;
    const db = getDb();
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // --- Resolve the Jellyfin Item ID ---
    let jellyfinItemId = episode.jellyfin_item_id;

    if (!jellyfinItemId) {
      // No cached Jellyfin ID — search Jellyfin by file path
      const mediaRoot = process.env.MEDIA_ROOT || '/media/anime';
      const fullPath = episode.file_path.startsWith('/')
        ? episode.file_path
        : `${mediaRoot}/${episode.file_path}`;

      const item = await findItemByPath(fullPath);

      if (!item) {
        return NextResponse.json(
          {
            error: 'Episode not found in Jellyfin library',
            detail: `Could not find a Jellyfin item matching path: ${fullPath}. Make sure Jellyfin has scanned this file.`,
          },
          { status: 404 }
        );
      }

      jellyfinItemId = item.Id;

      // Cache the Jellyfin item ID so we don't have to search every time
      try {
        db.prepare('UPDATE episodes SET jellyfin_item_id = ? WHERE id = ?').run(jellyfinItemId, episodeId);
      } catch (cacheErr) {
        // If the column doesn't exist yet, that's okay — we'll still return the stream
        console.warn('Could not cache jellyfin_item_id:', cacheErr.message);
      }
    }

    // --- Build the stream URL ---
    const hlsUrl = getStreamUrl(jellyfinItemId);
    const directUrl = getDirectStreamUrl(jellyfinItemId);

    // --- Extract Subtitles ---
    const itemInfo = await getItemById(jellyfinItemId);
    const mediaSource = itemInfo?.MediaSources?.[0];
    const mediaSourceId = mediaSource?.Id;
    const subtitles = [];

    if (mediaSource && mediaSource.MediaStreams) {
      mediaSource.MediaStreams.forEach(stream => {
        if (stream.Type === 'Subtitle') {
          // Jellyfin will convert most text-based subs (ASS, SRT) to VTT
          subtitles.push({
            index: stream.Index,
            language: stream.Language || 'Und',
            title: stream.Title || stream.DisplayTitle || stream.Language || `Subtitle ${stream.Index}`,
            url: getSubtitleUrl(jellyfinItemId, mediaSourceId, stream.Index),
            isDefault: stream.IsDefault
          });
        }
      });
    }

    return NextResponse.json({
      episodeId: episode.id,
      jellyfinItemId,
      hlsUrl,
      directUrl,
      subtitles,
      type: 'hls',
    });
  } catch (error) {
    console.error('Stream error:', error);
    return NextResponse.json({ error: 'Stream error', detail: error.message }, { status: 500 });
  }
}
