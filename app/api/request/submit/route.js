import { NextResponse } from 'next/server';
import {
  getSeerrAnimeMovieDetails,
  getSeerrAnimeTvDetails,
  requestSeerrMovie,
  requestSeerrTv,
  SeerrApiError,
} from '../../../../lib/seerr';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const mediaId = Number(body?.mediaId);
  const mediaType = String(body?.mediaType || 'tv').toLowerCase();
  const seasons = body?.seasons === 'all'
    ? 'all'
    : Array.isArray(body?.seasons) && body.seasons.length > 0
      ? body.seasons.map(Number).filter(Number.isFinite)
      : 'all';

  if (!Number.isInteger(mediaId) || mediaId <= 0) {
    return NextResponse.json({ error: 'A valid Seerr media ID is required.' }, { status: 400 });
  }

  if (!['tv', 'movie'].includes(mediaType)) {
    return NextResponse.json({ error: 'A valid Seerr media type is required.' }, { status: 400 });
  }

  try {
    if (mediaType === 'movie') {
      await getSeerrAnimeMovieDetails(mediaId);
      const result = await requestSeerrMovie(mediaId);
      return NextResponse.json({ ok: true, request: result });
    }

    await getSeerrAnimeTvDetails(mediaId);
    const result = await requestSeerrTv(mediaId, seasons);
    return NextResponse.json({ ok: true, request: result });
  } catch (error) {
    const status = error instanceof SeerrApiError ? error.status : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
