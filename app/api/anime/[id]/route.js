import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const db = getDb();
    const anime = db.prepare('SELECT * FROM anime WHERE id = ?').get(id);
    
    if (!anime) {
      return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    }

    const episodes = db.prepare('SELECT * FROM episodes WHERE anime_id = ? ORDER BY episode_number ASC').all(id);

    return NextResponse.json({
      ...anime,
      genres: JSON.parse(anime.genres || '[]'),
      studios: JSON.parse(anime.studios || '[]'),
      episodes,
    });
  } catch (error) {
    console.error('Anime detail error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
