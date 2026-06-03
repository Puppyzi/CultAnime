import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/admin-api';
import { getDb } from '../../../../lib/db';
import { notifyJellyfinMediaUpdated, refreshJellyfinLibrary } from '../../../../lib/jellyfin';
import { syncJellyfinLibrary } from '../../../../lib/admin-sync';
import {
  getServerRemovalPreview,
  removeAnimeFromServer,
  ServerRemovalError,
} from '../../../../lib/server-removal';

export const dynamic = 'force-dynamic';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function settleDelayMs() {
  const value = Number(process.env.SERVER_REMOVE_SYNC_SETTLE_MS);
  return Number.isFinite(value) && value >= 0 ? value : 8000;
}

async function refreshJellyfinAfterRemoval(paths = []) {
  const result = {
    media_updated: false,
    library_refresh: false,
    warnings: [],
  };

  const updates = paths
    .filter(Boolean)
    .map(path => ({ path, updateType: 'Deleted' }));

  if (updates.length > 0) {
    try {
      await notifyJellyfinMediaUpdated(updates);
      result.media_updated = true;
    } catch (error) {
      result.warnings.push(`Jellyfin media update failed: ${error.message}`);
    }
  }

  try {
    await refreshJellyfinLibrary();
    result.library_refresh = true;
  } catch (error) {
    result.warnings.push(`Jellyfin library refresh failed: ${error.message}`);
  }

  return result;
}

function deleteLocalAnime(animeId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM anime WHERE id = ?').run(animeId);
  return result.changes > 0;
}

function errorResponse(error) {
  const status = error instanceof ServerRemovalError ? error.status : 500;
  return NextResponse.json(
    {
      error: error.message,
      detail: error.payload || null,
    },
    { status }
  );
}

export async function GET(request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const animeId = searchParams.get('anime_id');
    return NextResponse.json(await getServerRemovalPreview(animeId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));

    if (body.confirm !== 'DELETE') {
      return NextResponse.json({ error: 'Type DELETE to confirm server removal.' }, { status: 400 });
    }

    const removal = await removeAnimeFromServer(body.anime_id);
    const jellyfin = await refreshJellyfinAfterRemoval(removal.jellyfin_paths || []);
    const delayMs = settleDelayMs();

    if (delayMs > 0) {
      await wait(delayMs);
    }

    let sync = null;
    const warnings = [...(jellyfin.warnings || [])];

    try {
      sync = await syncJellyfinLibrary({ syncAll: true });
    } catch (error) {
      warnings.push(`CultAnime sync failed: ${error.message}`);
    }

    const localRemoved = deleteLocalAnime(removal.anime_id);

    return NextResponse.json({
      success: true,
      removal,
      jellyfin,
      sync,
      local_removed: localRemoved,
      warnings,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
