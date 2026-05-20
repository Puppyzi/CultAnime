import { NextResponse } from 'next/server';
import { getDirectStreamUrl } from '../../../../lib/jellyfin';
import { resolveEpisodePlayback } from '../../../../lib/playback';
import {
  buildDownloadFilename,
  contentDisposition,
  copyHeader,
  resolveDownloadSize,
} from '../../../../lib/download';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const { episodeId } = await params;
    const { searchParams } = new URL(request.url);
    const playback = await resolveEpisodePlayback(episodeId);

    if (!playback) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const { episode, jellyfinItemId, mediaSourceId, mediaSource } = playback;
    const directUrl = getDirectStreamUrl(jellyfinItemId, { mediaSourceId });
    const filename = buildDownloadFilename(episode, mediaSource);

    if (searchParams.get('metadata') === '1') {
      return NextResponse.json({
        episodeId: episode.id,
        filename,
        sizeBytes: await resolveDownloadSize(mediaSource, directUrl),
      }, {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const requestHeaders = {};
    const range = request.headers.get('range');

    if (range) {
      requestHeaders.Range = range;
    }

    const upstream = await fetch(directUrl, {
      headers: requestHeaders,
      cache: 'no-store',
    });

    if (!upstream.ok && upstream.status !== 206) {
      const detail = await upstream.text().catch(() => '');
      return NextResponse.json(
        { error: 'Episode download failed', detail: detail || upstream.statusText },
        { status: upstream.status }
      );
    }

    const headers = new Headers();
    copyHeader(upstream.headers, headers, 'accept-ranges');
    copyHeader(upstream.headers, headers, 'content-length');
    copyHeader(upstream.headers, headers, 'content-range');
    copyHeader(upstream.headers, headers, 'content-type');
    copyHeader(upstream.headers, headers, 'etag');
    copyHeader(upstream.headers, headers, 'last-modified');

    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/octet-stream');
    }

    headers.set('content-disposition', contentDisposition(filename));
    headers.set('cache-control', 'private, no-store');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
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

    console.error('Episode download error:', error);
    return NextResponse.json({ error: 'Episode download error', detail: error.message }, { status: 500 });
  }
}
