import { NextResponse } from 'next/server';
import { searchAnilist, getAnilistAnime, formatAnilistData } from '../../../../lib/anilist';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    if (!query) return NextResponse.json({ results: [] });

    const page = await searchAnilist(query);
    const results = page.media.map(m => ({
      anilist_id: m.id,
      title: m.title.english || m.title.romaji,
      title_romaji: m.title.romaji,
      cover_image: m.coverImage.large,
      genres: m.genres,
      episodes: m.episodes,
      year: m.seasonYear,
      rating: m.averageScore,
      format: m.format,
    }));

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { anilist_id } = await request.json();
    const media = await getAnilistAnime(anilist_id);
    const data = formatAnilistData(media);
    return NextResponse.json({ anime: data });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
