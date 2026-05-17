import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    if (!q) return NextResponse.json({ anime: [] });

    const db = getDb();
    const anime = db.prepare(
      `SELECT * FROM anime WHERE title LIKE ? OR title_romaji LIKE ? OR title_english LIKE ? ORDER BY rating DESC LIMIT 10`
    ).all(`%${q}%`, `%${q}%`, `%${q}%`);

    const enriched = anime.map(a => ({
      ...a,
      genres: JSON.parse(a.genres || '[]'),
    }));

    return NextResponse.json({ anime: enriched });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
