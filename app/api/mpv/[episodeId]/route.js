import { NextResponse } from 'next/server';
import { getDirectStreamUrl } from '../../../../lib/jellyfin';
import { resolveEpisodePlayback } from '../../../../lib/playback';

function cleanText(value, fallback) {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function sanitizeFilename(value) {
  return cleanText(value, 'cultanime')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    || 'cultanime';
}

function quoteCommandArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function buildTitle(episode) {
  const seriesTitle = cleanText(episode.anime_title, 'CultAnime');
  const episodeTitle = cleanText(episode.title, `Episode ${episode.episode_number}`);
  return `${seriesTitle} - ${episodeTitle}`;
}

function buildPlaylist(title, directUrl) {
  return [
    '#EXTM3U',
    `#EXTINF:-1,${title}`,
    directUrl,
    '',
  ].join('\n');
}

export async function GET(request, { params }) {
  try {
    const { episodeId } = await params;
    const { searchParams } = new URL(request.url);
    const playback = await resolveEpisodePlayback(episodeId);

    if (!playback) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const { episode, jellyfinItemId, mediaSourceId } = playback;
    const directUrl = getDirectStreamUrl(jellyfinItemId, { mediaSourceId });
    const title = buildTitle(episode);
    const command = [
      'mpv',
      '--hwdec=auto-safe',
      quoteCommandArg(directUrl),
    ].join(' ');

    if (searchParams.get('format') === 'playlist') {
      const filename = `${sanitizeFilename(title)}.m3u`;

      return new NextResponse(buildPlaylist(title, directUrl), {
        headers: {
          'Content-Type': 'audio/x-mpegurl; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, max-age=60',
        },
      });
    }

    return NextResponse.json({
      episodeId: episode.id,
      jellyfinItemId,
      title,
      directUrl,
      command,
      playlistUrl: `/api/mpv/${episode.id}?format=playlist`,
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

    console.error('MPV handoff error:', error);
    return NextResponse.json({ error: 'MPV handoff error', detail: error.message }, { status: 500 });
  }
}
