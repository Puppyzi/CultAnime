import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getSyncPreview, syncJellyfinLibrary } from '../../../../lib/admin-sync';

/**
 * GET /api/admin/sync
 *
 * Preview what Jellyfin has vs what CultAnime has.
 */
export async function GET() {
  try {
    return NextResponse.json(await getSyncPreview());
  } catch (error) {
    console.error('Sync preview error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/sync
 *
 * Sync one or more Jellyfin series into CultAnime.
 * Body: { jellyfin_ids: ["id1", "id2", ...] } or { sync_all: true }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { jellyfin_ids, sync_all } = body;

    if (!sync_all && !jellyfin_ids?.length) {
      return NextResponse.json({ error: 'Provide jellyfin_ids or sync_all' }, { status: 400 });
    }

    return NextResponse.json(await syncJellyfinLibrary({
      jellyfinIds: jellyfin_ids || [],
      syncAll: Boolean(sync_all),
    }));
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
