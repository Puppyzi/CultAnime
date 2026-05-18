import { NextResponse } from 'next/server';
import { fetchJellyfinResource } from '../../../lib/jellyfin';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');
    const mediaSourceId = searchParams.get('mediaSourceId');
    const streamIndex = searchParams.get('streamIndex');

    if (!itemId || !mediaSourceId || !streamIndex) {
      return NextResponse.json({ error: 'Missing subtitle parameters' }, { status: 400 });
    }

    if (!/^\d+$/.test(streamIndex)) {
      return NextResponse.json({ error: 'Invalid subtitle stream index' }, { status: 400 });
    }

    const endpoint = `/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSourceId)}/Subtitles/${streamIndex}/0/Stream.vtt`;
    const subtitleRes = await fetchJellyfinResource(endpoint, {
      headers: {
        Accept: 'text/vtt,*/*',
      },
    });
    const subtitleText = await subtitleRes.text();

    return new NextResponse(subtitleText, {
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Subtitle proxy error:', error);
    return NextResponse.json({ error: 'Subtitle error', detail: error.message }, { status: 500 });
  }
}
