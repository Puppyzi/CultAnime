import { NextResponse } from 'next/server';
import { getAiringAnime } from '../../../lib/anilist';

export const dynamic = 'force-dynamic';

const VALID_SEASONS = new Set(['WINTER', 'SPRING', 'SUMMER', 'FALL']);

function normalizeSeason(value) {
  const season = String(value || '').trim().toUpperCase();
  return VALID_SEASONS.has(season) ? season : null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const season = normalizeSeason(searchParams.get('season'));
  const year = searchParams.get('year');
  const page = searchParams.get('page');
  const category = searchParams.get('category');

  try {
    const data = await getAiringAnime({ season, year, page, category, perPage: 50 });

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
