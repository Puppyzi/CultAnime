import { NextResponse } from 'next/server';
import { getEpisodeSegments } from '../../../../../lib/episode-segments';

export async function GET(request, { params }) {
  const { episodeId } = await params;
  const id = Number(episodeId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid episode.' }, { status: 400 });
  }
  try {
    const result = await getEpisodeSegments(id);
    if (!result) return NextResponse.json({ error: 'Episode not found.' }, { status: 404 });
    return NextResponse.json(
      { episodeId: id, segments: result.segments },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch {
    // Skipping is optional. Neither upstream failures nor missing metadata block playback.
    return NextResponse.json(
      { episodeId: id, segments: [] },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
