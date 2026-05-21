import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

export const dynamic = 'force-dynamic';

function parseJsonList(value) {
  try {
    return JSON.parse(value || '[]');
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM anime ORDER BY title COLLATE NOCASE ASC').all();
    const countEpisode = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE anime_id = ?');
    const anime = rows.map(item => ({
      ...item,
      genres: parseJsonList(item.genres),
      studios: parseJsonList(item.studios),
      episode_count: countEpisode.get(item.id)?.count || 0,
    }));

    return NextResponse.json({ anime, total: anime.length });
  } catch (error) {
    console.error('Anime index error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
