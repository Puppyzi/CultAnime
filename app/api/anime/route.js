import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';
import { reconcileForRead } from '../../../lib/library-reconciler';

export const dynamic = 'force-dynamic';

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, character => `\\${character}`);
}

export async function GET(request) {
  try {
    await reconcileForRead();

    const db = getDb();
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre')?.trim();
    const search = searchParams.get('q')?.trim();
    const sort = searchParams.get('sort') || 'created_at';
    const order = searchParams.get('order') || 'DESC';
    const parsedPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const parsedLimit = Number.parseInt(searchParams.get('limit') || '20', 10);
    const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
    const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 20;
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        anime.*,
        (SELECT COUNT(*) FROM episodes e WHERE e.anime_id = anime.id) AS episode_count
      FROM anime
    `;
    let countQuery = 'SELECT COUNT(*) as total FROM anime';
    const queryParams = [];
    const where = [];

    if (genre) {
      where.push('genres LIKE ?');
      queryParams.push(`%"${genre}"%`);
    }

    if (search) {
      const term = `%${escapeLike(search)}%`;
      where.push(`(
        title LIKE ? ESCAPE '\\'
        OR title_romaji LIKE ? ESCAPE '\\'
        OR title_english LIKE ? ESCAPE '\\'
      )`);
      queryParams.push(term, term, term);
    }

    if (where.length > 0) {
      const clause = ` WHERE ${where.join(' AND ')}`;
      query += clause;
      countQuery += clause;
    }

    const validSorts = ['created_at', 'title', 'rating', 'year'];
    const sortCol = validSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';
    const tieBreaker = sortCol === 'created_at' ? `, id ${sortOrder}` : '';
    query += ` ORDER BY ${sortCol} ${sortOrder}${tieBreaker} LIMIT ? OFFSET ?`;

    const total = db.prepare(countQuery).get(...queryParams)?.total || 0;
    const anime = db.prepare(query).all(...queryParams, limit, offset);

    const enriched = anime.map(a => ({
      ...a,
      genres: JSON.parse(a.genres || '[]'),
      studios: JSON.parse(a.studios || '[]'),
    }));

    return NextResponse.json({ anime: enriched, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Anime list error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
