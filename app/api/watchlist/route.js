import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getDb } from '../../../lib/db';
import { createSessionCookie, getSessionId } from '../../../lib/session';

export async function GET() {
  try {
    const sessionId = await getSessionId();
    const db = getDb();
    const watchlist = db.prepare(`
      SELECT
        w.*,
        a.title,
        a.cover_image,
        a.genres,
        a.rating,
        a.episodes_total,
        a.year,
        a.format,
        a.status,
        e.episode_number,
        e.title AS episode_title,
        (SELECT COUNT(*) FROM episodes ep WHERE ep.anime_id = a.id) AS episode_count
      FROM watchlist w
      JOIN anime a ON w.anime_id = a.id
      LEFT JOIN episodes e ON w.episode_id = e.id
      WHERE w.session_id = ?
      ORDER BY w.added_at DESC
    `).all(sessionId);

    const enriched = watchlist.map(w => ({
      ...w,
      genres: JSON.parse(w.genres || '[]'),
      kind: w.episode_id ? 'episode' : 'series',
    }));

    return NextResponse.json({ watchlist: enriched });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sessionId = await getSessionId();
    const body = await request.json();
    const animeId = Number(body?.anime_id);
    const episodeId = body?.episode_id == null ? null : Number(body.episode_id);
    const action = body?.action === 'remove' ? 'remove' : 'add';
    const db = getDb();

    if (!Number.isInteger(animeId) || animeId <= 0) {
      return NextResponse.json({ error: 'A valid anime ID is required.' }, { status: 400 });
    }

    if (episodeId !== null && (!Number.isInteger(episodeId) || episodeId <= 0)) {
      return NextResponse.json({ error: 'A valid episode ID is required.' }, { status: 400 });
    }

    if (episodeId !== null) {
      const episode = db.prepare('SELECT id FROM episodes WHERE id = ? AND anime_id = ?').get(episodeId, animeId);
      if (!episode) {
        return NextResponse.json({ error: 'Episode not found for this anime.' }, { status: 404 });
      }
    }

    if (action === 'remove') {
      if (episodeId !== null) {
        db.prepare('DELETE FROM watchlist WHERE session_id = ? AND episode_id = ?').run(sessionId, episodeId);
      } else {
        db.prepare('DELETE FROM watchlist WHERE session_id = ? AND anime_id = ? AND episode_id IS NULL')
          .run(sessionId, animeId);
      }
    } else if (episodeId !== null) {
      db.prepare(`
        INSERT OR IGNORE INTO watchlist (session_id, anime_id, episode_id) VALUES (?, ?, ?)
      `).run(sessionId, animeId, episodeId);
    } else {
      db.prepare(`
        INSERT OR IGNORE INTO watchlist (session_id, anime_id, episode_id) VALUES (?, ?, NULL)
      `).run(sessionId, animeId);
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(createSessionCookie(sessionId, request));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
