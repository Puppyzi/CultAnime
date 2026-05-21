import { NextResponse } from 'next/server';
import { searchSeerrTv, SeerrApiError } from '../../../../lib/seerr';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get('q') || '').trim();
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);

  if (query.length < 2) {
    return NextResponse.json({ results: [], page: 1, totalPages: 1, totalResults: 0 });
  }

  try {
    const results = await searchSeerrTv(query, page);
    return NextResponse.json(results);
  } catch (error) {
    const status = error instanceof SeerrApiError ? error.status : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
