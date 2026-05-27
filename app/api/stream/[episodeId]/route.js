import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getProxiedJellyfinUrl, getStreamUrl, getDirectStreamUrl } from '../../../../lib/jellyfin';
import { chooseAudioTrack, chooseSubtitle, requiresBurnedInSubtitle, resolveEpisodePlayback } from '../../../../lib/playback';

/**
 * GET /api/stream/[episodeId]
 *
 * Returns a JSON object with same-origin proxied Jellyfin playback URLs.
 * The frontend uses the HLS URL with hls.js to play the video without exposing
 * the private Jellyfin address to browsers.
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
    const { searchParams } = new URL(request.url);
    const subtitleModeParam = searchParams.get('subtitleMode');
    const requestedSubtitleMode = ['burned', 'soft', 'off'].includes(subtitleModeParam)
      ? subtitleModeParam
      : 'auto';
    const requestedSubtitleIndex = searchParams.get('subtitleStreamIndex');
    const requestedAudioIndex = searchParams.get('audioStreamIndex');
    const playback = await resolveEpisodePlayback(episodeId);

    if (!playback) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const { episode, jellyfinItemId, mediaSourceId, audioTracks, subtitles } = playback;
    const streamSessionId = crypto.randomUUID();
    const streamIdentity = `cultanime-${episode.id}-${streamSessionId}`;
    const audioTrack = chooseAudioTrack(audioTracks, requestedAudioIndex);
    const autoSubtitle = requestedSubtitleMode === 'auto'
      ? chooseSubtitle(subtitles, requestedSubtitleIndex)
      : null;
    const burnedInSubtitle = requestedSubtitleMode === 'burned'
      ? chooseSubtitle(subtitles, requestedSubtitleIndex)
      : requiresBurnedInSubtitle(autoSubtitle)
        ? autoSubtitle
        : null;

    const hlsUrl = getStreamUrl(jellyfinItemId, burnedInSubtitle ? {
      mediaSourceId,
      deviceId: streamIdentity,
      playSessionId: streamSessionId,
      audioStreamIndex: audioTrack?.index,
      subtitleMethod: 'Encode',
      subtitleStreamIndex: burnedInSubtitle.index,
      alwaysBurnInSubtitleWhenTranscoding: true,
    } : {
      mediaSourceId,
      deviceId: streamIdentity,
      playSessionId: streamSessionId,
      audioStreamIndex: audioTrack?.index,
    });
    const directUrl = burnedInSubtitle ? null : getDirectStreamUrl(jellyfinItemId, {
      mediaSourceId,
      audioStreamIndex: audioTrack?.index,
    });

    return NextResponse.json({
      episodeId: episode.id,
      jellyfinItemId,
      hlsUrl: getProxiedJellyfinUrl(hlsUrl),
      directUrl: directUrl ? getProxiedJellyfinUrl(directUrl) : null,
      audioTracks,
      audioStreamIndex: audioTrack?.index ?? null,
      subtitles,
      streamSessionId,
      subtitleMode: burnedInSubtitle ? 'burned' : requestedSubtitleMode === 'off' ? 'off' : 'soft',
      burnedInSubtitleIndex: burnedInSubtitle?.index ?? null,
      type: 'hls',
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    if (error.code === 'JELLYFIN_ITEM_NOT_FOUND') {
      return NextResponse.json(
        {
          error: 'Episode not found in Jellyfin library',
          detail: error.message,
        },
        { status: 404 }
      );
    }

    console.error('Stream error:', error);
    return NextResponse.json({ error: 'Stream error', detail: error.message }, { status: 500 });
  }
}
