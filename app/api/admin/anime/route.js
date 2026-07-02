import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

const UPDATABLE_COLUMNS = new Set([
  'title', 'title_romaji', 'title_english', 'description', 'cover_image',
  'banner_image', 'genres', 'status', 'episodes_total', 'rating', 'year',
  'season', 'format', 'studios', 'anilist_id', 'jellyfin_id',
]);

export async function POST(request) {
  try {
    const db = getDb();
    const body = await request.json();
    const { title, title_romaji, title_english, description, cover_image, banner_image,
      genres, status, episodes_total, rating, year, season, format, studios, anilist_id } = body;

    const result = db.prepare(`
      INSERT INTO anime (title, title_romaji, title_english, description, cover_image, banner_image,
        genres, status, episodes_total, rating, year, season, format, studios, anilist_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, title_romaji, title_english, description, cover_image, banner_image,
      typeof genres === 'string' ? genres : JSON.stringify(genres || []),
      status, episodes_total, rating, year, season, format,
      typeof studios === 'string' ? studios : JSON.stringify(studios || []),
      anilist_id);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const db = getDb();
    const body = await request.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const unknownFields = Object.keys(fields).filter(key => !UPDATABLE_COLUMNS.has(key));
    if (unknownFields.length > 0) {
      return NextResponse.json(
        { error: `Unknown fields: ${unknownFields.join(', ')}` },
        { status: 400 }
      );
    }

    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = ?`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    db.prepare(`UPDATE anime SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const db = getDb();
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
    db.prepare('DELETE FROM anime WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
