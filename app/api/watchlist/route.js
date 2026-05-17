import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getDb } from '../../../lib/db';
import { getSessionId } from '../../../lib/session';

export async function GET() {
  try {
    const sessionId = await getSessionId();
    const db = getDb();
    const watchlist = db.prepare(`
      SELECT w.*, a.title, a.cover_image, a.genres, a.rating, a.episodes_total, a.year
      FROM watchlist w
      JOIN anime a ON w.anime_id = a.id
      WHERE w.session_id = ?
      ORDER BY w.added_at DESC
    `).all(sessionId);

    const enriched = watchlist.map(w => ({
      ...w,
      genres: JSON.parse(w.genres || '[]'),
    }));

    return NextResponse.json({ watchlist: enriched });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sessionId = await getSessionId();
    const { anime_id, action } = await request.json();
    const db = getDb();

    if (action === 'remove') {
      db.prepare('DELETE FROM watchlist WHERE session_id = ? AND anime_id = ?').run(sessionId, anime_id);
    } else {
      db.prepare(`
        INSERT OR IGNORE INTO watchlist (session_id, anime_id) VALUES (?, ?)
      `).run(sessionId, anime_id);
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set('cultanime_session', sessionId, {
      httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, path: '/',
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
