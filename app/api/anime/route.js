import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';
import { reconcileForRead } from '../../../lib/library-reconciler';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await reconcileForRead();

    const db = getDb();
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre');
    const sort = searchParams.get('sort') || 'created_at';
    const order = searchParams.get('order') || 'DESC';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM anime';
    let countQuery = 'SELECT COUNT(*) as total FROM anime';
    const queryParams = [];

    if (genre) {
      query += ' WHERE genres LIKE ?';
      countQuery += ' WHERE genres LIKE ?';
      queryParams.push(`%"${genre}"%`);
    }

    const validSorts = ['created_at', 'title', 'rating', 'year'];
    const sortCol = validSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`;

    const total = db.prepare(countQuery).get(...queryParams)?.total || 0;
    const anime = db.prepare(query).all(...queryParams, limit, offset);

    // Get episode counts
    const enriched = anime.map(a => {
      const epCount = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE anime_id = ?').get(a.id);
      return { ...a, genres: JSON.parse(a.genres || '[]'), studios: JSON.parse(a.studios || '[]'), episode_count: epCount.count };
    });

    return NextResponse.json({ anime: enriched, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Anime list error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
