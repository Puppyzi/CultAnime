import { NextResponse } from 'next/server';
import { getSeerrAnimeTvDetails, SeerrApiError } from '../../../../lib/seerr';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mediaId = Number(searchParams.get('mediaId'));

  if (!Number.isInteger(mediaId) || mediaId <= 0) {
    return NextResponse.json({ error: 'A valid Seerr media ID is required.' }, { status: 400 });
  }

  try {
    const details = await getSeerrAnimeTvDetails(mediaId);
    return NextResponse.json(details);
  } catch (error) {
    const status = error instanceof SeerrApiError ? error.status : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
