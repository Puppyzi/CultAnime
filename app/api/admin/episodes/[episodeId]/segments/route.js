import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../../lib/admin-api';
import { getEpisodeSegments, saveEpisodeSegments } from '../../../../../../lib/episode-segments';

async function handle(request, context, save) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const { episodeId } = await context.params;
  const id = Number(episodeId);
  if (!Number.isSafeInteger(id) || id <= 0)
    return NextResponse.json({ error: 'Invalid episode.' }, { status: 400 });
  try {
    const result = save
      ? await saveEpisodeSegments(id, await request.json())
      : await getEpisodeSegments(id, { refresh: true });
    return NextResponse.json(result || { error: 'Episode not found.' }, {
      status: result ? 200 : 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Could not load skip settings.' },
      { status: error.status || 400 }
    );
  }
}

export const GET = (request, context) => handle(request, context, false);
export const PUT = (request, context) => handle(request, context, true);
