import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getDb } from '../../../lib/db';
import { createSessionCookie, getSessionId } from '../../../lib/session';

export async function GET() {
  try {
    const sessionId = await getSessionId();
    const db = getDb();
    const history = db.prepare(`
      SELECT wh.*, e.episode_number, e.anime_id, a.title, a.cover_image, a.title_romaji, a.format
      FROM watch_history wh
      JOIN episodes e ON wh.episode_id = e.id
      JOIN anime a ON wh.anime_id = a.id
      WHERE wh.session_id = ? AND wh.completed = 0
      ORDER BY wh.updated_at DESC
      LIMIT 20
    `).all(sessionId);

    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sessionId = await getSessionId();
    const { episode_id, anime_id, progress, duration, completed } = await request.json();
    const db = getDb();

    db.prepare(`
      INSERT INTO watch_history (session_id, episode_id, anime_id, progress, duration, completed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id, episode_id) DO UPDATE SET
        progress = excluded.progress,
        duration = excluded.duration,
        completed = excluded.completed,
        updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, episode_id, anime_id, progress, duration || 0, completed ? 1 : 0);

    const response = NextResponse.json({ success: true });
    response.cookies.set(createSessionCookie(sessionId, request));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const episodeId = Number(body?.episode_id);
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    return NextResponse.json({ error: 'A valid episode ID is required.' }, { status: 400 });
  }

  try {
    const sessionId = await getSessionId();
    const db = getDb();

    db.prepare('DELETE FROM watch_history WHERE session_id = ? AND episode_id = ?').run(sessionId, episodeId);

    const response = NextResponse.json({ success: true });
    response.cookies.set(createSessionCookie(sessionId, request));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
