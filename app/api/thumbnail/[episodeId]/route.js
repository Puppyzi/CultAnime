import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { fetchJellyfinResource, findItemByPath } from '../../../../lib/jellyfin';

export const dynamic = 'force-dynamic';

function imageSize(value, fallback) {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1280, Math.max(80, parsed));
}

function fallbackToCover(coverImage, requestUrl) {
  if (coverImage) {
    return NextResponse.redirect(new URL(coverImage, requestUrl));
  }

  return NextResponse.json({ error: 'Episode thumbnail not found' }, { status: 404 });
}

export async function GET(request, { params }) {
  try {
    const { episodeId } = await params;
    const { searchParams } = new URL(request.url);
    const width = imageSize(searchParams.get('width'), 320);
    const height = imageSize(searchParams.get('height'), 180);
    const db = getDb();
    const episode = db.prepare(`
      SELECT e.*, a.cover_image
      FROM episodes e
      LEFT JOIN anime a ON a.id = e.anime_id
      WHERE e.id = ?
    `).get(episodeId);

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    let jellyfinItemId = episode.jellyfin_item_id;

    if (!jellyfinItemId && episode.file_path) {
      const mediaRoot = process.env.MEDIA_ROOT || '/media/anime';
      const fullPath = episode.file_path.startsWith('/')
        ? episode.file_path
        : `${mediaRoot}/${episode.file_path}`;
      const item = await findItemByPath(fullPath);
      jellyfinItemId = item?.Id || null;

      if (jellyfinItemId) {
        db.prepare('UPDATE episodes SET jellyfin_item_id = ? WHERE id = ?').run(jellyfinItemId, episode.id);
      }
    }

    if (!jellyfinItemId) {
      return fallbackToCover(episode.cover_image, request.url);
    }

    try {
      const imageParams = new URLSearchParams({
        fillWidth: String(width),
        fillHeight: String(height),
        quality: '90',
      });
      const image = await fetchJellyfinResource(`/Items/${jellyfinItemId}/Images/Primary?${imageParams.toString()}`, {
        headers: { Accept: 'image/*' },
      });
      const headers = new Headers();
      const contentType = image.headers.get('content-type') || 'image/jpeg';

      headers.set('content-type', contentType);
      headers.set('cache-control', 'private, max-age=3600');

      return new NextResponse(image.body, {
        status: image.status,
        headers,
      });
    } catch {
      return fallbackToCover(episode.cover_image, request.url);
    }
  } catch (error) {
    console.error('Episode thumbnail error:', error);
    return NextResponse.json({ error: 'Episode thumbnail error', detail: error.message }, { status: 500 });
  }
}
