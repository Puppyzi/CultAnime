import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';
import { queryAnimeSeries, readAnimeSeriesRows } from '../../../lib/anime-series';

export async function GET(request) {
  try {
    const q = new URL(request.url).searchParams.get('q')?.trim();
    if (!q) return NextResponse.json({ anime: [] });
    return NextResponse.json(queryAnimeSeries(readAnimeSeriesRows(getDb()), { search: q, sort: 'rating', limit: 10 }));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
