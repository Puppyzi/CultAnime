import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export async function POST(request) {
  try {
    const db = getDb();
    const { anime_id, episode_number, title, file_path } = await request.json();

    const result = db.prepare(`
      INSERT INTO episodes (anime_id, episode_number, title, file_path)
      VALUES (?, ?, ?, ?)
    `).run(anime_id, episode_number, title || `Episode ${episode_number}`, file_path);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const db = getDb();
    const { id, episode_number, title, file_path } = await request.json();
    db.prepare(`UPDATE episodes SET episode_number = ?, title = ?, file_path = ? WHERE id = ?`)
      .run(episode_number, title, file_path, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = getDb();
    const { id } = await request.json();
    db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
